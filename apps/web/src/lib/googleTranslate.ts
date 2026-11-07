// ゲーム詳細の「最新ニュース」を Google 翻訳で読むためのリンク（2026-11-07 ユーザー判断）。
//
// - 翻訳の API（DeepL・Google Cloud Translation）は使わない。キーも料金も要らず、訳すのは読みたい人が押したときだけ
// - 本文を `text=` に入れた URL を新しいタブで開くと、Google 翻訳のページが最初から入力済みで開く。
//   **この URL の形は Google の公式資料には無く、使っている人たちの書き込みで知られている形**（変わったら開くだけで訳が出なくなる）
// - コピーして貼る形にしないのは、ブラウザは別のサイトへ自動で貼り付けられないため（開いた人が自分で貼る手間が残る）
// - 長さの上限は確かめられなかったので、GOOGLE_TRANSLATE_MAX_CHARS 文字で切り、さらに URL に入れた長さが
//   GOOGLE_TRANSLATE_MAX_ENCODED を超えないところで切る（漢字やハングルは1文字が9文字ほどに膨らむため）。切ったことは画面に出す
// - かな（ひらがな・カタカナ）が文字（空白を除く）の20%以上ある記事は日本語とみなしてボタンを出さない。日本語の文はかなが
//   ふつう半分近くある。英語の記事にゲーム名などのカタカナが混じっても出す。漢字は中国語のこともあるので数えない

/** Google 翻訳に渡す最大の文字数（題名と本文を合わせて） */
export const GOOGLE_TRANSLATE_MAX_CHARS = 3000;
/** text= に入れたあと（encodeURIComponent 後）の最大の長さ */
export const GOOGLE_TRANSLATE_MAX_ENCODED = 8000;
/** かながこの割合以上なら日本語の記事とみなす */
const JAPANESE_KANA_RATIO = 0.2;

const KANA = /[\u3040-\u30ff]/g;

export function looksJapanese(text: string): boolean {
  const letters = text.replace(/\s/g, "").length;
  if (letters === 0) return false;
  return (text.match(KANA)?.length ?? 0) / letters >= JAPANESE_KANA_RATIO;
}

/** 題名と本文の段落から、Google 翻訳で日本語にするリンクを作る。日本語の記事なら null */
export function googleTranslateLink(title: string, paragraphs: string[]): { url: string; truncated: boolean } | null {
  const full = [title, ...paragraphs].filter((s) => s.trim().length > 0).join("\n\n");
  if (full.trim().length === 0 || looksJapanese(full)) return null;
  // 絵文字などのサロゲートペアの途中で切らないよう、文字（コードポイント）単位で数える
  const chars = Array.from(full);
  let encoded = "";
  let taken = 0;
  for (const c of chars) {
    const e = encodeURIComponent(c);
    if (taken >= GOOGLE_TRANSLATE_MAX_CHARS || encoded.length + e.length > GOOGLE_TRANSLATE_MAX_ENCODED) break;
    encoded += e;
    taken++;
  }
  return {
    url: `https://translate.google.com/?sl=auto&tl=ja&text=${encoded}&op=translate`,
    truncated: taken < chars.length,
  };
}
