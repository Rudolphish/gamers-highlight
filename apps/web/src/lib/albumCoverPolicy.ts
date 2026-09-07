import type { Prisma } from "@gamers-highlight/db";

// アルバムのカバー画像を「どの投稿から選ぶか」の方針を1箇所にまとめる。
//
// **順番はこう**:
//   1. Steam連携があればそのヘッダー画像（`Album.steamAppId`）
//   2. 無ければ、この方針に合う投稿のうち**いちばん新しいもの**
//   3. それも無ければカバー無し
//
// 2の「この方針に合う投稿」をここで決める。いまは**自前ストレージに置いた画像・動画だけ**で、
// YouTubeは外している——アルバムの見た目が、自分たちが撮ったものではなく
// YouTubeのサムネイル（i.ytimg.com）に置き換わってしまうため。
//
// **方針を変えたくなったらこのファイルだけ直す。** 一覧はグループ詳細（`lib/groupData.ts`）と
// アルバム一覧（`/albums`）の2箇所で組み立てているので、条件を各画面に書くと必ず片方だけ古くなる。
// 例えば「YouTubeもカバーに使う」なら下の配列に "YOUTUBE" を足すだけで両方に効く。

/** カバーの候補にしてよいメディアの種類 */
export const COVER_MEDIA_TYPES = ["IMAGE", "VIDEO"] as const;

/**
 * カバー候補を1件だけ引くための `include` の中身。
 * `album.photos[0]` がカバー候補になる（0件ならカバー無し）。
 */
export const coverPhotoQuery = {
  where: { mediaType: { in: [...COVER_MEDIA_TYPES] } },
  orderBy: { createdAt: "desc" },
  take: 1,
} satisfies Prisma.Album$photosArgs;
