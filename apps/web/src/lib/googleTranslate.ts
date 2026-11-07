// ゲーム詳細の「最新ニュース」を Google 翻訳で読むためのリンク（2026-11-07 ユーザー判断）。
//
// - 翻訳の API（DeepL・Google Cloud Translation）は使わない。キーも料金も要らず、訳すのは読みたい人が押したときだけ
// - 本文を `text=` に入れた URL を新しいタブで開くと、Google 翻訳のページが最初から入力済みで開く。
//   **この URL の形は Google の公式資料には無く、使っている人たちの書き込みで知られている形**（変わったら開くだけで訳が出なくなる）
// - コピーして貼る形にしないのは、ブラウザは別のサイトへ自動で貼り付けられないため（開いた人が自分で貼る手間が残る）
// - 長さの上限は確かめられなかったので、本文は GOOGLE_TRANSLATE_MAX_CHARS 文字で切る（切ったことは画面に出す）
// - かな（ひらがな・カタカナ）を含む記事は日本語とみなしてボタンを出さない。漢字だけは中国語のこともあるので見ない

/** Google 翻訳に渡す最大の文字数（題名と本文を合わせて） */
export const GOOGLE_TRANSLATE_MAX_CHARS = 3000;

const KANA = /[぀-ヿ]/;

export function looksJapanese(text: string): boolean {
  return KANA.test(text);
}

/** 題名と本文の段落から、Google 翻訳で日本語にするリンクを作る。日本語の記事なら null */
export function googleTranslateLink(title: string, paragraphs: string[]): { url: string; truncated: boolean } | null {
  const full = [title, ...paragraphs].filter((s) => s.trim().length > 0).join("\n\n");
  if (full.trim().length === 0 || looksJapanese(full)) return null;
  // 絵文字などのサロゲートペアの途中で切らないよう、文字（コードポイント）単位で数える
  const chars = Array.from(full);
  const truncated = chars.length > GOOGLE_TRANSLATE_MAX_CHARS;
  const text = truncated ? chars.slice(0, GOOGLE_TRANSLATE_MAX_CHARS).join("") : full;
  return {
    url: `https://translate.google.com/?sl=auto&tl=ja&text=${encodeURIComponent(text)}&op=translate`,
    truncated,
  };
}
