/**
 * メンバー追加・役割変更のAPIが受け付ける役割。**OWNER は渡せない。**
 *
 * 以前は body.role をそのまま保存していたため、知らない文字列で500になり、
 * "OWNER" もそのまま通っていた（画面は EDITOR / VIEWER しか送らない）。
 * オーナーは `Album.ownerId` / `Group.ownerId` が正本で、メンバーの役割で増やすものではない。
 * 2026-10-11 のテストの棚卸しで、一度も叩かれていなかったこのAPIを確かめて発覚した。
 */
export type MemberRole = "EDITOR" | "VIEWER";

export function parseMemberRole(value: unknown): MemberRole | null {
  return value === "EDITOR" || value === "VIEWER" ? value : null;
}

export const INVALID_ROLE_MESSAGE = "role は EDITOR か VIEWER を指定してください";
