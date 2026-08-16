import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";

/**
 * ログイン中のユーザー。**idとemailだけ**を持つ。
 *
 * 呼び出し側の大半（86箇所）はidしか使わない。名前やアバターまで要る場面は
 * `db.user.findUnique` を別途書くこと（`/settings/discord` の discordUserId など）。
 */
export type CurrentUser = { id: string; email: string | null };

/**
 * ログイン中のユーザーをセッションから取る。未ログインならnull。
 *
 * **DBを引かないのが既定の経路。** 以前は全ページ・全APIの先頭で
 * `db.user.findUnique({ where: { email: session.user.email } })` を実行しており、
 * 他の判定すべての前段で必ず直列に待つ1往復が全リクエストに乗っていた。
 * いまは `lib/auth.ts` の jwt コールバックがサインイン時に1回だけ引いて
 * トークンに載せている。
 *
 * DBに落ちるのは**idを載せる前に発行されたトークン**の場合だけ。
 * トークンの有効期限（既定30日）が切れれば全員が新しい形に入れ替わるので、
 * そのころにこのフォールバックは消してよい。消すのを忘れても実害は無い
 * （常にidが入るので、この分岐に来なくなるだけ）。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;

  if (session?.user?.id) return { id: session.user.id, email };
  if (!email) return null;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  return user;
}

/**
 * 管理者かどうかも一緒に要る場面向け。
 * 判定は `isAdminEmail` と同じくメールアドレスで行う（セッションの `isAdmin` は表示専用）。
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}
