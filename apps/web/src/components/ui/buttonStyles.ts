// ボタンの形と高さ（2026-10 のデザイン刷新・段階5）。**高さはスマホ44px・PC36px。**
// 以前は 20px 前後の小さなボタンが多く、スマホでは指で狙いにくかった。44px は指で確実に押せる大きさの目安、
// PC はマウスなので 36px に詰める。browser.mjs の B135 がグループ画面のボタンと選択欄を全部測っている。
//
// 文字列の定数にしてあるのは、Tailwind がソースの文字列からクラスを拾うため（組み立てた文字列は拾えない）。
export const BUTTON_HEIGHT = "h-11 md:h-9";
// 正方形のアイコンだけのボタン（歯車・ゴミ箱など）
export const ICON_BUTTON_SIZE = "h-11 w-11 md:h-9 md:w-9";

const BASE = "inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm transition disabled:opacity-50";

/** 目立たせる操作（写真を投稿・追加する）。青は1画面に1〜2個まで */
export const primaryButton = `${BASE} ${BUTTON_HEIGHT} bg-accent px-4 font-bold text-accent-ink hover:brightness-110`;
/**
 * 区画の見出しの横の「足す」操作（新規アルバム・ゲームを追加・ウィッシュリストに追加する）。薄い青の面に青い文字。
 * 追加系だと色で分かるようにしつつ、画面でいちばん目立つのは青の塗り（写真を投稿）のままにする
 * （同じ塗りにするとグループ画面に青の塗りが4つ並ぶ。ユーザーが2案から選んだ）
 */
export const addButton = `${BASE} ${BUTTON_HEIGHT} bg-steam-blue/15 px-4 font-bold text-steam-blue hover:bg-steam-blue/25`;
/** ふつうの操作（メンバー・さらに表示） */
export const secondaryButton = `${BASE} ${BUTTON_HEIGHT} bg-steam-panel px-4 text-steam-text hover:bg-steam-border`;
/** 取り返しのつかない操作（削除） */
export const dangerButton = `${BASE} ${BUTTON_HEIGHT} bg-danger/10 px-4 text-danger hover:bg-danger/20`;
/** アイコンだけのボタン。必ず aria-label を付ける */
export const iconButton = `${BASE} ${ICON_BUTTON_SIZE} bg-steam-panel text-steam-text hover:bg-steam-border`;
/** 枠も背景も無い、アイコンだけの控えめなボタン（カードの中のゴミ箱など） */
export const ghostIconButton = `${BASE} ${ICON_BUTTON_SIZE} text-steam-muted hover:bg-steam-panel hover:text-steam-text`;
/**
 * アイコンだけの取り返しのつかない操作（ウィッシュリストのカードの取り下げなど）。最初から赤で出す。
 * 灰色の `ghostIconButton` だと隣のリアクションの札と同じ色に見えて押し間違えた（2026-10-31 ユーザー報告）。
 * 押したら `ConfirmDialog` で確かめる
 */
export const dangerIconButton = `${BASE} ${ICON_BUTTON_SIZE} text-danger hover:bg-danger/10`;

/** 切り替えの札の形と高さだけ。押されたときの色を部品ごとに変えたいとき（ゲームの状態の色など）に使う */
export const chipBase = `${BASE} ${BUTTON_HEIGHT} border px-3`;
/** 文字だけの控えめなボタン（条件をクリア など） */
export const textButton = `${BASE} ${BUTTON_HEIGHT} px-2 text-steam-muted hover:text-steam-blue`;

/** 切り替えの札（絞り込み・並び替え・リアクション）。押されている状態を active で渡す */
export function chipButton(active: boolean): string {
  return `${chipBase} ${
    active ? "border-steam-blue bg-steam-blue/10 text-steam-blue" : "border-steam-border text-steam-muted hover:border-steam-blue hover:text-steam-text"
  }`;
}

/** 選択欄と入力欄の高さ。ボタンと並べたときに揃える */
export const FIELD_HEIGHT = BUTTON_HEIGHT;
export const fieldClass = `${FIELD_HEIGHT} rounded-lg border border-steam-border bg-steam-bg px-3 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50`;

/**
 * 状態や評価の札（プレイ中・非常に好評・投票中・値段）。押せないので高さの決まりの外。
 * 枠線ではなく薄い面で色を付ける（デザイン刷新の段階6。以前は四角い枠線の札だった）
 */
export function badge(tone: "blue" | "positive" | "warning" | "neutral"): string {
  const color = {
    blue: "bg-steam-blue/15 text-steam-blue",
    positive: "bg-positive/15 text-positive",
    warning: "bg-warning/15 text-warning",
    neutral: "bg-steam-panel text-steam-text",
  }[tone];
  return `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${color}`;
}
