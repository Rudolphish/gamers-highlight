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

/**
 * 有効なら招待を返す。無効なら理由を返す（例外は投げない）。
 *
 * `reserved` は「この人は既にログイン時に1回分を消費している」という意味で、
 * その場合だけ使用回数の上限判定を飛ばす。飛ばさないと、maxUses:1 のリンクで
 * 招待された本人が自分の消費に阻まれて加入できなくなる。
 */
export function validateInvite(
  invite: InviteRecord | null,
  opts: { reserved?: boolean } = {}
): { ok: true; invite: InviteRecord } | { ok: false; reason: InviteInvalidReason } {
  if (!invite) return { ok: false, reason: "not-found" };
  if (invite.revokedAt) return { ok: false, reason: "revoked" };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (!opts.reserved && invite.usedCount >= invite.maxUses) {
    return { ok: false, reason: "used-up" };
  }
  return { ok: true, invite };
}

/**
 * 「この人はこの招待でログイン済み（＝1回分を消費済み）か」を返す。
 *
 * ログイン時に作られた`AllowlistEntry`が、まだ`inviteId`を持ったままなら消費済み。
 * 加入時にnullへ戻すので、二重に消費することはない。
 */
export async function findInviteReservation(inviteId: string, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { discordUserId: true, email: true },
  });
  if (!user) return null;

  const or = [
    ...(user.discordUserId ? [{ discordUserId: user.discordUserId }] : []),
    ...(user.email ? [{ email: user.email }] : []),
  ];
  if (or.length === 0) return null;

  return db.allowlistEntry.findFirst({ where: { inviteId, OR: or } });
}

/**
 * 取り消し・期限切れになった招待から作られ、まだ加入していない許可リスト登録を消す。
 *
 * これが無いと「リンクを踏んでログインだけした人」が、リンクを取り消した後も
 * アプリに入れたままになる（取り消しはグループ加入しか止められない）。
 * 定期実行の枠が空いていないので、招待を触る操作のついでに回収する。
 */
export async function purgePendingInviteAllowlist(): Promise<number> {
  const { count } = await db.allowlistEntry.deleteMany({
    where: {
      invite: {
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: new Date() } }],
      },
    },
  });
  return count;
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
 * **登録と同時にトークンを1回分消費する。** 許可リストへの登録はアプリへの恒久的な
 * ログイン権限そのものなので、ここを数えないと「maxUses:1 のリンクでも、誰も加入を
 * 終えていない間は踏んだ人全員がログインできる」という抜け道になる。
 * 加入時に二重で数えないよう、消費済みかどうかは`AllowlistEntry.inviteId`で見分ける。
 */
export async function registerAllowlistFromInvite(discordUserId: string): Promise<void> {
  try {
    const token = cookies().get(INVITE_COOKIE)?.value;
    if (!token) return;

    const invite = await findInviteByToken(token);
    const result = validateInvite(invite);
    if (!result.ok || !invite) return;

    const issuer = invite.createdBy.name ?? invite.createdBy.email ?? "不明";

    await db.$transaction(async (tx) => {
      // 既に許可リストにいる人（＝再ログインや既存メンバー）は消費しない
      const existing = await tx.allowlistEntry.findFirst({ where: { discordUserId } });
      if (existing) return;

      // 同時に複数人が踏んでも上限を超えないよう、条件付き更新で消費する
      const updated = await tx.groupInvite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          usedCount: { lt: invite.maxUses },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (updated.count === 0) return;

      // discordUserIdの一意制約で落ちた場合はトランザクションごと巻き戻り、消費も取り消される
      await tx.allowlistEntry.create({
        data: {
          discordUserId,
          inviteId: invite.id,
          note: `招待リンク経由（${invite.group.name} / 発行: ${issuer}）`,
        },
      });
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
 *
 * ログイン時に消費済みの人（このリンクで許可リストに登録された本人）は、ここでは加算しない。
 * 1人の参加でトークンが2回減ってしまうため。
 */
export async function acceptInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await findInviteByToken(token);
  if (!invite) return { ok: false, reason: "not-found" };

  const reservation = await findInviteReservation(invite.id, userId);
  const result = validateInvite(invite, { reserved: Boolean(reservation) });
  if (!result.ok) return { ok: false, reason: result.reason };

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
    if (reservation) {
      // ログイン時に消費済み。加入したので「未加入の登録」ではなくなり、
      // リンクを取り消しても回収されない正式なメンバーになる
      const settled = await tx.allowlistEntry.updateMany({
        where: { id: reservation.id, inviteId: invite.id },
        data: { inviteId: null },
      });
      // 同時に2回加入しようとした場合、先に確定した方だけが通る
      if (settled.count === 0) return false;
    } else {
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
    }

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
