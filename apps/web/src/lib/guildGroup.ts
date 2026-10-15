import { db } from "./db";
import { hasGroupPermission } from "./permissions";

/**
 * Discordのサーバー（guildId）に紐づくグループがあり、その人がそのグループのメンバーでないか。
 *
 * Botは「サーバーにいる人」の投稿を全部拾うが、**サーバーにいる＝グループのメンバーではない。**
 * 許可リストに載ってログインしたことがある人なら、他のグループのサーバーにいるだけで
 * そのグループのアルバムへ写真を入れられ、`#タグ` で新しいアルバムまで作れた。
 * 取り込み（`/api/discord/ingest`）と `/tag`（`/api/discord/tag`）はここで弾く。
 *
 * 紐づくグループが無いサーバーは false（その場合はどのグループにも入らず未分類で残る）。
 */
export async function isOutsiderOfGuildGroup(guildId: unknown, userId: string): Promise<boolean> {
  if (typeof guildId !== "string" || guildId === "") return false;
  const group = await db.group.findUnique({ where: { guildId }, select: { id: true } });
  if (!group) return false;
  return !(await hasGroupPermission(group.id, userId, "VIEWER"));
}
