/**
 * メッセージ本文から最初のハッシュタグを抽出し、正規化して返す。
 * 例: "#EldenRing クリアした！" → "eldenring"
 * 複数タグがあっても最初の1つだけを採用する（複数ゲームまたがりの投稿は想定外）。
 */
export function extractGameTag(content: string): string | null {
  const match = content.match(/#([\p{L}\p{N}_]+)/u);
  if (!match) return null;
  return match[1].toLowerCase();
}

/** タグから表示用のゲーム名を生成する（初回登録時のみ使用、後でUIから改名可能） */
export function tagToDisplayName(tag: string): string {
  return tag;
}
