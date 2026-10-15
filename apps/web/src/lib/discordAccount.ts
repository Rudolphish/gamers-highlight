import { db } from "./db";

// Discordでログインした人を、アプリの User の行に結びつける。lib/auth.ts の signIn から呼ぶ。
//
// **照合の鍵は Discord のユーザーID。メールアドレスではない。**
// 以前はメールアドレスで upsert していたため、Aさんが Discord のメールを変えたあと、
// 別のメンバーがその古いアドレスを自分の Discord に設定してログインすると、
// Aさんの行に自分の Discord ID が書き込まれ Aさんとして入れてしまう筋があった
// （2026-10-15 の脆弱性チェックで発覚。実害は未確認）。
//
// **Discordが確認していないメールアドレスは信用しない。** Discord のアカウントは
// メール未確認のまま使えるので、未確認のアドレスは照合にも保存にも使わない。

export type LinkResult =
  | { ok: true; userId: string; how: "existing" | "linked-by-email" | "created" }
  | { ok: false; reason: "email-owned-by-another-discord-account" };

export async function linkDiscordUser(p: {
  discordUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}): Promise<LinkResult> {
  const email = p.emailVerified && p.email ? p.email : null;

  // 1. すでに結びついている（2回目以降のログイン）
  const byDiscord = await db.user.findUnique({ where: { discordUserId: p.discordUserId }, select: { id: true, email: true } });
  if (byDiscord) {
    // 確認済みのアドレスに変わっていて、誰も使っていなければ追従する（他の人の行のアドレスは奪わない）
    if (email && email !== byDiscord.email) {
      const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (!taken) await db.user.update({ where: { id: byDiscord.id }, data: { email } });
    }
    return { ok: true, userId: byDiscord.id, how: "existing" };
  }

  // 2. Discord と結びつく前に作られた行（許可リストのメールで登録された人など）。確認済みのアドレスでだけ結ぶ
  if (email) {
    const byEmail = await db.user.findUnique({ where: { email }, select: { id: true, discordUserId: true } });
    if (byEmail) {
      if (byEmail.discordUserId && byEmail.discordUserId !== p.discordUserId) {
        return { ok: false, reason: "email-owned-by-another-discord-account" };
      }
      await db.user.update({ where: { id: byEmail.id }, data: { discordUserId: p.discordUserId } });
      return { ok: true, userId: byEmail.id, how: "linked-by-email" };
    }
  }

  // 3. 初めての人。未確認のアドレスは保存しない（後から本当の持ち主が来たときに締め出さないため）
  const created = await db.user.create({
    data: { email: email ?? undefined, name: p.name, avatarUrl: p.image, provider: "discord", discordUserId: p.discordUserId },
    select: { id: true },
  });
  return { ok: true, userId: created.id, how: "created" };
}

/**
 * いまも許可リストに載っているか。ログイン中の人を定期的に見直すために使う（lib/auth.ts の jwt）。
 * 許可リストから外しても、以前は「次のログイン」でしか止まらず、ログインの有効期限は使うたびに延びるので、
 * 使い続けている人は**ずっと入れたまま**だった（2026-10-15 の脆弱性チェックで発覚）。
 */
export async function isStillAllowed(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, discordUserId: true } });
  if (!user) return false;
  const or = [
    user.discordUserId ? { discordUserId: user.discordUserId } : null,
    user.email ? { email: user.email } : null,
  ].filter((c): c is { discordUserId: string } | { email: string } => c !== null);
  if (or.length === 0) return false;
  return (await db.allowlistEntry.findFirst({ where: { OR: or }, select: { id: true } })) !== null;
}
