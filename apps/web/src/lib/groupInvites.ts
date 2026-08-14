import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { GroupRole } from "@prisma/client";
import { db } from "./db";
import { postDiscordMessage } from "./discord";
import { APP_SETTING_KEYS, getAppSetting } from "./appSettings";

/**
 * 招待トークンを一時的に保持するCookie。
 *
 * Discord OAuthはリダイレクトを挟むため、`/invite/[token]` から
 * 「ログイン後もどのリンク経由だったか」を運ぶ必要がある。callbackUrlに載せる方法もあるが、
 * リダイレクトを何度か経由する間に落ちたり、ログにトークンが残ったりする。
 * httpOnly Cookieなら経路上に出ず、使い終わったら確実に消せる。
 */
export const INVITE_COOKIE = "sharestaq-invite";
const COOKIE_MAX_AGE_SECONDS = 15 * 60; // ログインを終えるまでの間だけ持てばよい

export const DEFAULT_EXPIRY_HOURS = 72;

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export type InviteInvalidReason = "not-found" | "revoked" | "expired" | "used-up";

export const INVALID_REASON_TEXT: Record<InviteInvalidReason, string> = {
  "not-found": "この招待リンクは存在しません。",
  revoked: "この招待リンクは取り消されています。",
  expired: "この招待リンクは有効期限が切れています。",
  "used-up": "この招待リンクは既に使用されています。",
};

type InviteRecord = {
  id: string;
  groupId: string;
  role: GroupRole;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
};

/** 有効なら招待を返す。無効なら理由を返す（例外は投げない） */
export function validateInvite(
  invite: InviteRecord | null
): { ok: true; invite: InviteRecord } | { ok: false; reason: InviteInvalidReason } {
  if (!invite) return { ok: false, reason: "not-found" };
  if (invite.revokedAt) return { ok: false, reason: "revoked" };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (invite.usedCount >= invite.maxUses) return { ok: false, reason: "used-up" };
  return { ok: true, invite };
}

export async function findInviteByToken(token: string) {
  return db.groupInvite.findUnique({
    where: { token },
    include: {
      group: { select: { id: true, name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
}

export function setInviteCookie(token: string) {
  cookies().set(INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearInviteCookie() {
  cookies().delete(INVITE_COOKIE);
}

/**
 * 招待リンク経由の初回ログインに限り、許可リストへの登録を代行する（auth.tsのsignInから呼ぶ）。
 *
 * **既存の許可リスト判定は一切変更しない。** ここで`AllowlistEntry`を作るだけで、
 * 判定そのものは従来どおり後段で行われる。トークンが無効なら何もしないので、
 * その場合は通常どおり「許可リストに無い＝ログイン拒否」になる。
 *
 * トークンの消費（usedCountの加算）はここでは行わない。グループ加入まで到達して
 * 初めて消費する（ログインしただけで打ち止めになると、加入に失敗した人が締め出される）。
 */
export async function registerAllowlistFromInvite(discordUserId: string): Promise<void> {
  try {
    const token = cookies().get(INVITE_COOKIE)?.value;
    if (!token) return;

    const invite = await findInviteByToken(token);
    const result = validateInvite(invite);
    if (!result.ok || !invite) return;

    const existing = await db.allowlistEntry.findFirst({ where: { discordUserId } });
    if (existing) return;

    const issuer = invite.createdBy.name ?? invite.createdBy.email ?? "不明";
    await db.allowlistEntry.create({
      data: {
        discordUserId,
        note: `招待リンク経由（${invite.group.name} / 発行: ${issuer}）`,
      },
    });
  } catch (e) {
    // ここで例外を投げるとログイン自体が落ちる。登録できなければ通常の判定に委ねる
    console.error("[invite] failed to register allowlist entry", e);
  }
}

export type AcceptResult =
  | { ok: true; groupId: string; alreadyMember: boolean }
  | { ok: false; reason: InviteInvalidReason };

/**
 * 招待リンクを使ってグループに加入する。
 *
 * 同時アクセスでの多重使用を防ぐため、使用回数の加算は
 * 「まだ上限に達していない場合のみ」という条件付き更新で行う（更新件数0なら他が使い切っている）。
 */
export async function acceptInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await findInviteByToken(token);
  const result = validateInvite(invite);
  if (!result.ok || !invite) {
    return { ok: false, reason: result.ok ? "not-found" : result.reason };
  }

  // 既にメンバー（オーナー含む）なら、トークンを消費せずに終える
  const group = await db.group.findUnique({
    where: { id: invite.groupId },
    select: { ownerId: true },
  });
  const existingMember = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: invite.groupId, userId } },
  });
  if (group?.ownerId === userId || existingMember) {
    return { ok: true, groupId: invite.groupId, alreadyMember: true };
  }

  const consumed = await db.$transaction(async (tx) => {
    const updated = await tx.groupInvite.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        usedCount: { lt: invite.maxUses },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (updated.count === 0) return false;

    await tx.groupMember.create({
      data: {
        groupId: invite.groupId,
        userId,
        role: invite.role,
        acceptedAt: new Date(),
      },
    });
    await tx.groupInviteUse.create({ data: { inviteId: invite.id, userId } });
    return true;
  });

  if (!consumed) return { ok: false, reason: "used-up" };

  await notifyInviteUsed(invite.group.name, invite.groupId, userId);
  return { ok: true, groupId: invite.groupId, alreadyMember: false };
}

/**
 * 招待リンクが使われたことをDiscordに知らせる。
 * リンクが漏れて意図しない相手が入った場合、気づく手段はこれしかない。
 */
async function notifyInviteUsed(groupName: string, groupId: string, userId: string) {
  try {
    const channelId = await getAppSetting(APP_SETTING_KEYS.errorNotifyChannelId);
    if (!channelId) return;

    const user = await db.user.findUnique({ where: { id: userId } });
    const who = user?.name ?? user?.email ?? userId;
    await postDiscordMessage(
      channelId,
      [
        "👤 **招待リンクからメンバーが参加しました**",
        `**グループ**: ${groupName}`,
        `**参加者**: ${who}`,
        "心当たりが無い場合、リンクが第三者に渡っている可能性があります。",
      ].join("\n")
    );
  } catch (e) {
    console.error("[invite] failed to notify", e);
  }
}
