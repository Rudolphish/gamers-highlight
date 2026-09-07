// 画面が扱うメディアの種類。
//
// **`MediaType` を直接 import しない。** Prismaが生成する型はDBの都合（enumの値）で、
// クライアントコンポーネントの props に持ち込むと `@prisma/client` がバンドルに入る。
// ここに写しを1つ置いて、画面側は全部これを使う。
export type MediaKind = "IMAGE" | "VIDEO" | "YOUTUBE";

/**
 * 自前ストレージ（R2）にバイナリを置いている種類か。
 *
 * **これで分けたい場面が多い**——容量を数える／削除時にオブジェクトを消す／
 * サイズ・長さの上限をかける／`<video>` で再生する。YOUTUBE はどれも当てはまらない。
 */
export function isStoredMedia(kind: MediaKind): boolean {
  return kind === "IMAGE" || kind === "VIDEO";
}

/** 再生できる（＝静止画ではない）種類か。再生アイコンや「動画」の表記に使う */
export function isPlayable(kind: MediaKind): boolean {
  return kind === "VIDEO" || kind === "YOUTUBE";
}
