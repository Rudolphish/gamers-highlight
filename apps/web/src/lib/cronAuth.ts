import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron からの呼び出しか（`Authorization: Bearer <CRON_SECRET>`）。
 *
 * **`CRON_SECRET` が未設定なら誰も通さない。** 以前は `Bearer ${process.env.CRON_SECRET}` と
 * 文字列で突き合わせていたので、未設定だと期待値が `"Bearer undefined"` になり、
 * その文字列を送れば誰でも日次処理（Discordへの投稿・外部APIの呼び出し）を走らせられた。
 */
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
