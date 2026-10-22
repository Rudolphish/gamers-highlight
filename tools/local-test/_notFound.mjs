// ページが「見つかりません」に差し替わったかを、**ステータスではなく本文で**見る。
// ストリーミングが先に始まるルート（以前の loading.tsx）では、notFound() しても200のまま返る（CLAUDE.md）。
//
// **目印は Next.js の版で変わる。** 14 は `NEXT_NOT_FOUND`、15 は `NEXT_HTTP_ERROR_FALLBACK;404`。
// 15 に上げたとき、画面は正しく「見つかりません」になっていたのに、権限まわりの確認が28件
// 「見えている」で落ちた（目印を3つのファイルに書き写していた）。ここ1箇所で持つ。
// 版を上げて目印がまた変わっても、**通ってしまう側ではなく落ちる側に倒れる**ので気づける。
export const NOT_FOUND_MARK = "NEXT_HTTP_ERROR_FALLBACK;404";

/** 本文が not-found 画面か */
export function showsNotFound(text) {
  return text.includes(NOT_FOUND_MARK);
}
