// アルバムの入力欄の長さ上限。
// **APIの検証と画面の maxLength で同じ値を使う。** 別々に書くと、
// 画面では打てるのにAPIが400を返す（またはその逆）という食い違いが起きる。
export const MAX_ALBUM_TITLE_LENGTH = 100;
export const MAX_ALBUM_DESCRIPTION_LENGTH = 500;
