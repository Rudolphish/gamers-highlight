import { unstable_cache } from "next/cache";
import { db } from "./db";
import { groupTag } from "./cacheTags";

/**
 * グループ詳細ページが読む中身。**権限判定はここに入れない。**
 *
 * 呼ぶ側が先に `hasGroupPermission` を通し、通った場合だけ呼ぶこと。
 * キャッシュキーにユーザーは含めない（`lib/cacheTags.ts` の方針を参照）。
 *
 * 無効化は `lib/cacheTags.ts` の `invalidateGroup` から。
 * アルバムの新規作成・改名や写真の増減でもここの表示が変わる（アルバムカードが
 * 最新の1枚と枚数を出しているため）ので、それらの経路も `invalidateGroup` を呼ぶ。
 */
export function getGroupContent(groupId: string, albumPageSize: number) {
  return unstable_cache(
    async () =>
      db.group.findUnique({
        where: { id: groupId },
        include: {
          owner: true,
          members: { include: { user: true } },
          albums: {
            orderBy: { updatedAt: "desc" },
            take: albumPageSize,
            include: {
              owner: true,
              members: { take: 4, orderBy: { invitedAt: "asc" }, include: { user: true } },
              photos: { orderBy: { createdAt: "desc" }, take: 1 },
              _count: { select: { photos: true, members: true } },
            },
          },
          _count: { select: { albums: true } },
          games: {
            orderBy: { createdAt: "desc" },
            include: { addedBy: true, interests: { include: { user: true } } },
          },
          proposals: {
            where: { status: "PENDING" },
            orderBy: { createdAt: "desc" },
            include: { proposedBy: true, reactions: true },
          },
        },
      }),
    // ページ件数が変われば別のキャッシュになるようキーに含める
    ["group-content", groupId, String(albumPageSize)],
    { tags: [groupTag(groupId)] }
  )();
}

/**
 * 提案のカバー画像の救済用。以前は固定パスの組み立てを保存していたため
 * 新しめのタイトルで404になる（`CLAUDE.md` の「カバー画像のURLを組み立ててはいけない」）。
 *
 * `ExternalGameCache` は外部APIの取得結果で、グループとは無関係に更新されうる。
 * グループのタグで飛ばすと取りこぼすので、**時間で切る**（1時間）。
 * 古い値が出ても「カバー画像が前のまま」で済み、実害が小さいため。
 */
export function getProposalHeaderImages(steamAppIds: number[]) {
  const key = [...new Set(steamAppIds)].sort((a, b) => a - b).join(",");
  return unstable_cache(
    async () =>
      db.externalGameCache.findMany({
        where: { steamAppId: { in: steamAppIds } },
        select: { steamAppId: true, headerImage: true },
      }),
    ["proposal-header-images", key],
    { revalidate: 60 * 60 }
  )();
}
