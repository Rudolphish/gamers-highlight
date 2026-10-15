import { db } from "./db";

/**
 * 未分類の投稿の振り分け先として出す、その人のグループとアルバム。
 * 未分類の画面（自分の投稿）と `/admin/media`（管理者が全員の投稿）の両方が使う。
 *
 * **アルバムには groupId を必ず付ける。** 名前だけで並べると、別グループの同名アルバムに
 * 振り分けてしまう（画面側でグループを選んでから絞り込む）。
 * 実際に移せるかは振り分けのAPIが `hasAlbumPermission(…, "EDITOR")` で判定する
 * （管理者でも、自分が編集できないアルバムには入れられない。2026-10-15 ユーザー判断）。
 */
export async function getAssignTargets(userId: string) {
  const mine = { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
  const [albums, groups] = await Promise.all([
    db.album.findMany({
      where: mine,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, groupId: true },
    }),
    db.group.findMany({
      where: mine,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  return { albums, groups };
}
