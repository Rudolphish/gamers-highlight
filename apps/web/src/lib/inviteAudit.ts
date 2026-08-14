import { db } from "./db";

/** 招待経由の参加を「最近」と見なす期間（サマリの分子） */
export const RECENT_JOIN_DAYS = 30;

export type InviteStatus = "active" | "used-up" | "expired" | "revoked";

export type InviteAuditRow = {
  id: string;
  groupId: string;
  groupName: string;
  issuer: string;
  role: string;
  status: InviteStatus;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  /** このリンクから実際にグループへ参加した人 */
  joined: { name: string; usedAt: Date }[];
  /**
   * このリンクでログインしたが、まだグループに加入していない人数。
   * 加入していなくても許可リストには載っている＝アプリにはログインできる状態なので、
   * 監査上いちばん見たいのはここ。
   */
  pendingAccess: number;
};

export type InviteAuditSummary = {
  total: number;
  active: number;
  pendingAccess: number;
  recentJoins: number;
  windowDays: number;
};

export function statusOf(invite: {
  revokedAt: Date | null;
  expiresAt: Date;
  usedCount: number;
  maxUses: number;
}): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= Date.now()) return "expired";
  if (invite.usedCount >= invite.maxUses) return "used-up";
  return "active";
}

export const STATUS_LABEL: Record<InviteStatus, string> = {
  active: "有効",
  "used-up": "使用済み",
  expired: "期限切れ",
  revoked: "取り消し済み",
};

/**
 * 全グループの招待リンクを集める（管理者ページ用）。
 *
 * 招待リンクはグループのオーナーしか見られないため、
 * 「今どのリンクが生きているか」をアプリ全体で確認する手段がこれしかない。
 * 許可リストへの入口である以上、オーナー任せにはできない。
 */
export async function getInviteAudit(): Promise<{
  rows: InviteAuditRow[];
  summary: InviteAuditSummary;
}> {
  const invites = await db.groupInvite.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      group: { select: { id: true, name: true } },
      createdBy: { select: { name: true, email: true } },
      uses: {
        orderBy: { usedAt: "asc" },
        include: { user: { select: { name: true, email: true } } },
      },
      _count: { select: { allowlistEntries: true } },
    },
  });

  const cutoff = new Date(Date.now() - RECENT_JOIN_DAYS * 24 * 60 * 60 * 1000);

  const rows: InviteAuditRow[] = invites.map((i) => ({
    id: i.id,
    groupId: i.group.id,
    groupName: i.group.name,
    issuer: i.createdBy.name ?? i.createdBy.email ?? "不明",
    role: i.role,
    status: statusOf(i),
    maxUses: i.maxUses,
    usedCount: i.usedCount,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
    revokedAt: i.revokedAt,
    joined: i.uses.map((u) => ({
      name: u.user.name ?? u.user.email ?? "メンバー",
      usedAt: u.usedAt,
    })),
    // 加入時にinviteIdをnullへ戻しているので、残っている＝未加入
    pendingAccess: i._count.allowlistEntries,
  }));

  return {
    rows,
    summary: {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      pendingAccess: rows.reduce((n, r) => n + r.pendingAccess, 0),
      recentJoins: rows.reduce(
        (n, r) => n + r.joined.filter((j) => j.usedAt >= cutoff).length,
        0
      ),
      windowDays: RECENT_JOIN_DAYS,
    },
  };
}
