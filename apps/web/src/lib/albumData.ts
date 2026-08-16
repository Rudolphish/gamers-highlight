import { unstable_cache } from "next/cache";
import { db } from "./db";
import { albumTag, albumPhotosTag } from "./cacheTags";

/**
 * アルバム詳細ページが読む中身。**権限判定はここに入れない。**
 *
 * ここが返すのは「そのアルバムの中身」であって「この人が見てよいか」ではない。
 * 呼ぶ側（ページ）が先に `hasAlbumPermission` を通し、通った場合だけ呼ぶこと。
 * そのためキャッシュキーにユーザーは含めない（含めると、キーを間違えた瞬間に
 * 他人の中身が出るという壊れ方をする）。
 *
 * 無効化は `lib/cacheTags.ts` の `invalidateAlbum` / `invalidateAlbumPhotos` から。
 *
 * **`unstable_cache` は値をJSONにして保存する。** `Date` はISO文字列になって返るので、
 * 呼ぶ側で `.toISOString()` を呼ぶと落ちる。しかも**キャッシュヒットの回だけ**落ちるので、
 * 1回目の描画では気づけない（実際にこれで `capturedAt?.toISOString()` が壊れた）。
 * 日付はここで文字列に直してから返し、返り値の形をそのまま契約にする。
 */

export function getAlbumContent(albumId: string) {
  return unstable_cache(
    async () =>
      db.album.findUnique({
        where: { id: albumId },
        include: {
          members: { include: { user: true } },
          owner: true,
          groupGame: true,
          group: true,
        },
      }),
    ["album-content", albumId],
    { tags: [albumTag(albumId)] }
  )();
}

export type CachedAlbumPhoto = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  uploaderId: string;
  gameTitle: string | null;
  /** ISO文字列。Dateのまま返すとキャッシュ経由で文字列に化けるため、最初から文字列で揃える */
  capturedAt: string | null;
  uploaderName: string | null;
};

export function getAlbumPhotos(albumId: string): Promise<CachedAlbumPhoto[]> {
  return unstable_cache(
    async () => {
      const photos = await db.photo.findMany({
        where: { albumId },
        orderBy: { createdAt: "desc" },
        include: { uploader: { select: { name: true, email: true } } },
      });
      return photos.map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        mediaUrl: p.mediaUrl,
        thumbnailUrl: p.thumbnailUrl,
        durationSeconds: p.durationSeconds,
        uploaderId: p.uploaderId,
        gameTitle: p.gameTitle,
        capturedAt: p.capturedAt?.toISOString() ?? null,
        uploaderName: p.uploader.name ?? p.uploader.email,
      }));
    },
    ["album-photos", albumId],
    { tags: [albumPhotosTag(albumId)] }
  )();
}

export function getAlbumTags(albumId: string) {
  return unstable_cache(
    async () =>
      db.discordGameTag.findMany({
        where: { autoAlbumId: albumId },
        orderBy: { createdAt: "asc" },
      }),
    ["album-tags", albumId],
    { tags: [albumTag(albumId)] }
  )();
}
