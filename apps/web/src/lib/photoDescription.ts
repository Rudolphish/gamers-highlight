/**
 * 写真の説明の文字数上限。
 *
 * Lightboxに収まる範囲で、1〜2段落書ければ十分という判断。改行は許す
 * （場面の説明は箇条書きになりがちなため）。
 *
 * **APIと入力欄の両方から参照すること。** 片方だけ変えると、
 * 入力欄では書けるのに保存だけ400で弾かれる（またはその逆）という状態になる。
 *
 * ここに置いているのは、Next.jsのroute.tsがハンドラ以外の値をexportできないため
 * （`Type '500' is not assignable to type 'never'` で型チェックが落ちる）。
 */
export const MAX_DESCRIPTION_LENGTH = 500;
