import { revalidateTag } from "next/cache";

/**
 * ページが読むデータのキャッシュ（`unstable_cache`）を飛ばすためのタグ。
 *
 * **無効化は必ずここを通すこと。** 直接 `revalidateTag` を書かない。
 * 1箇所でも呼び忘れると「投稿したのに一覧に出ない」が起き、しかも
 * 時間で直らない（タグを飛ばすまで残る）。呼び忘れを探せるように、
 * 変更系の経路からはこのファイルの関数だけを呼ぶ形に揃えてある。
 *
 * ---
 *
 * **キャッシュしてよいのは「誰が見ても同じ中身」だけ。**
 * 権限判定（`hasAlbumPermission` / `hasGroupPermission`）はキャッシュしない。
 * ページは「毎回サーバーで権限を判定 → 通った人にだけキャッシュ済みの中身を返す」形にする。
 * キャッシュキーにユーザーを含めないのは意図的で、含めると
 * 「キーを間違えた瞬間に他人の中身が出る」という壊れ方をするため。
 * 権限を毎回引き直す代わりに、中身の取得だけを省く。
 */

/** アルバムそのもの（タイトル・説明・カバー・メンバー・タグ） */
export const albumTag = (albumId: string) => `album-${albumId}`;

/** アルバム内の写真・動画の一覧 */
export const albumPhotosTag = (albumId: string) => `album-photos-${albumId}`;

/** グループの中身（名前・メンバー・アルバム一覧・ゲーム・提案） */
export const groupTag = (groupId: string) => `group-${groupId}`;

/**
 * アルバムの情報が変わったとき（改名・カバー変更・メンバー増減・タグ編集・削除）。
 *
 * グループ詳細ページにもアルバムの名前とカバーが出るので、
 * `groupId` が分かるなら一緒に飛ばす。
 */
export function invalidateAlbum(albumId: string, groupId?: string | null): void {
  revalidateTag(albumTag(albumId));
  if (groupId) revalidateTag(groupTag(groupId));
}

/**
 * アルバム内の写真が増減したとき（アップロード・削除・アルバム間の移動・Discord取り込み）。
 *
 * **グループ側も飛ばす。** グループ詳細ページのアルバムカードは
 * 最新の1枚と枚数を出しているため、写真だけ増えても表示が変わる。
 */
export function invalidateAlbumPhotos(albumId: string, groupId?: string | null): void {
  revalidateTag(albumPhotosTag(albumId));
  if (groupId) revalidateTag(groupTag(groupId));
}

/**
 * グループの中身が変わったとき
 * （名前・メンバー・ゲームの追加/更新/削除・「気になる」・提案とリアクション・アルバムの新規作成）。
 */
export function invalidateGroup(groupId: string): void {
  revalidateTag(groupTag(groupId));
}
