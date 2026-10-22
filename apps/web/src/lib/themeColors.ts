/**
 * 画面のテーマの色（設定 → プロフィールで選ぶ。アカウントごとに `User.themeColor` に持つ）。
 *
 * 変わるのは「目立たせる色」（押せるもの・選ばれているもの・ロゴのマーク）と、**背景・面・枠線・文字の色味**。
 * 背景の側は明るさを変えず、色味だけをテーマの方へ控えめに寄せる（下の backgroundShades）。
 * 意味の決まった色（安い＝緑・削除＝赤・注意＝黄）はどのテーマでも同じ（ユーザー判断）。
 *
 * 色は CSS 変数で渡す。Tailwind の `steam-blue` / `accent` は `rgb(var(--accent) / <alpha>)`、
 * `steam-bg` などの背景・文字は `rgb(var(--c-bg) / <alpha>)` になっていて、
 * ログインしている画面では `(main)/layout.tsx` がその人の色の `:root{...}` を書き出す。
 * 既定（ブルー）は `globals.css` の `:root` にあり、ログイン画面・招待・エラー画面はそれで描かれる。
 * **目立たせる色を `#5ab0ea` のように、背景を `#11161d` のように直接書かない。** 書いたところだけテーマで変わらなくなる。
 *
 * このファイルは `"use client"` にしない（サーバーのレイアウトと API の検証からも値として読むため）。
 */

export const THEME_COLORS = [
  { id: "blue", label: "ブルー", accent: "#5ab0ea" },
  { id: "red", label: "レッド", accent: "#ff7a7a" },
  // 「安い」の緑（#7cc96b）と区別できるよう、青緑寄り
  { id: "green", label: "グリーン", accent: "#35c9a8" },
  // 注意の黄（#e3a83a）と区別できるよう、赤寄り
  { id: "orange", label: "オレンジ", accent: "#f59152" },
  { id: "pink", label: "ピンク", accent: "#f57fb8" },
  { id: "purple", label: "パープル", accent: "#b394ff" },
] as const;

export type ThemeColorId = (typeof THEME_COLORS)[number]["id"];

export const DEFAULT_THEME_COLOR: ThemeColorId = "blue";

export const THEME_COLOR_IDS = THEME_COLORS.map((t) => t.id) as [ThemeColorId, ...ThemeColorId[]];

export function isThemeColorId(value: unknown): value is ThemeColorId {
  return typeof value === "string" && THEME_COLORS.some((t) => t.id === value);
}

/** DB の値（null・知らない値を含む）を、使えるテーマの id にする */
export function resolveThemeColor(value: unknown): ThemeColorId {
  return isThemeColorId(value) ? value : DEFAULT_THEME_COLOR;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

type ThemeShades = {
  /** マークの手前の板の明るい側・暗い側 */
  markHi: string;
  markLo: string;
  /** 手前の板の縁（ぼかした光と、細い線） */
  markRim: string;
  markRim2: string;
  /** 奥の右の板 */
  markBackA: string;
  markBackB: string;
  /** グループの「遊んだ時間」の帯の地 */
  bannerFrom: string;
  bannerMid: string;
  bannerTo: string;
};

/**
 * ブルーは刷新のときに手で決めた値をそのまま使う（favicon の M1 と同じ。docs/design/favicon.md）。
 * ほかの色は、テーマの色から明るさ・鮮やかさを動かして作る（ブルーの手で決めた値に近くなる式にしてある）
 */
const BLUE_SHADES: ThemeShades = {
  markHi: "#7cc8f5",
  markLo: "#4a9fe0",
  markRim: "#c9ecff",
  markRim2: "#e6f6ff",
  markBackA: "#4a7fa8",
  markBackB: "#2f5674",
  bannerFrom: "#10202f",
  bannerMid: "#1d3348",
  bannerTo: "#22324a",
};

export function themeShades(id: ThemeColorId): ThemeShades {
  if (id === "blue") return BLUE_SHADES;
  const accent = THEME_COLORS.find((t) => t.id === id)!.accent;
  const [h, s, l] = hexToHsl(accent);
  return {
    markHi: hslToHex(h, s, l + 10),
    markLo: hslToHex(h, s * 0.85, l - 12),
    // 縁は明るい色（パープル・ピンク）だと真っ白に飛ぶので、少し色味が残る明るさで止める
    markRim: hslToHex(h, s, Math.min(l + 30, 90)),
    markRim2: hslToHex(h, s, Math.min(l + 38, 95)),
    markBackA: hslToHex(h, s * 0.45, l - 22),
    markBackB: hslToHex(h, s * 0.45, l - 34),
    bannerFrom: hslToHex(h, 49, 12),
    bannerMid: hslToHex(h, 43, 20),
    bannerTo: hslToHex(h, 37, 21),
  };
}

/** 背景・面・枠線・文字（tailwind.config.js の steam.*）。ブルーはデザイン刷新で決めた今のダークネイビー */
const BLUE_BACKGROUND = {
  bg: "#11161d",
  surface: "#18202a",
  panel: "#1d2631",
  border: "#263241",
  rail: "#0d1218",
  text: "#dde5ec",
  muted: "#a3afba",
  /** ロゴのマークの奥の左の板 */
  plateA: "#34465b",
  plateB: "#222e3c",
} as const;

type BackgroundShades = Record<keyof typeof BLUE_BACKGROUND, string>;

/**
 * ほかの色の背景は、今のダークネイビーを**明るさはそのまま**、色相をブルーからテーマの色へ回した分だけずらし、
 * 鮮やかさを半分にしたもの（見本で「弱」と呼んだ強さ。ユーザー判断）。ネイビーと同じ強さ（「中」）だと
 * レッド・ピンクが部屋ごと赤く見え、地の色につられて写真の色まで転んで見えたため。
 * ブルーだけは今のネイビーのまま（ネイビーは「中」の強さにあたる）
 */
const BACKGROUND_SATURATION = 0.5;

export function backgroundShades(id: ThemeColorId): BackgroundShades {
  if (id === "blue") return { ...BLUE_BACKGROUND };
  const accent = THEME_COLORS.find((t) => t.id === id)!.accent;
  const shift = hexToHsl(accent)[0] - hexToHsl(THEME_COLORS[0].accent)[0];
  const out = {} as BackgroundShades;
  for (const key of Object.keys(BLUE_BACKGROUND) as (keyof typeof BLUE_BACKGROUND)[]) {
    const [h, s, l] = hexToHsl(BLUE_BACKGROUND[key]);
    out[key] = hslToHex((h + shift + 360) % 360, s * BACKGROUND_SATURATION, l);
  }
  return out;
}

/** `:root{...}` の中身（宣言だけ）。`--accent` と `--c-*` は Tailwind の `<alpha-value>` に入れるため「R G B」の形 */
export function themeCssDeclarations(id: ThemeColorId): string {
  const accent = THEME_COLORS.find((t) => t.id === id)!.accent;
  const s = themeShades(id);
  const b = backgroundShades(id);
  return [
    `--accent:${hexToRgb(accent).join(" ")}`,
    `--c-bg:${hexToRgb(b.bg).join(" ")}`,
    `--c-surface:${hexToRgb(b.surface).join(" ")}`,
    `--c-panel:${hexToRgb(b.panel).join(" ")}`,
    `--c-border:${hexToRgb(b.border).join(" ")}`,
    `--c-rail:${hexToRgb(b.rail).join(" ")}`,
    `--c-text:${hexToRgb(b.text).join(" ")}`,
    `--c-muted:${hexToRgb(b.muted).join(" ")}`,
    `--mark-plate-a:${b.plateA}`,
    `--mark-plate-b:${b.plateB}`,
    `--mark-hi:${s.markHi}`,
    `--mark-lo:${s.markLo}`,
    `--mark-rim:${s.markRim}`,
    `--mark-rim2:${s.markRim2}`,
    `--mark-back-a:${s.markBackA}`,
    `--mark-back-b:${s.markBackB}`,
    `--banner-from:${s.bannerFrom}`,
    `--banner-mid:${s.bannerMid}`,
    `--banner-to:${s.bannerTo}`,
  ].join(";");
}

/** レイアウトが `<style>` に書き出す1行 */
export function themeCss(id: ThemeColorId): string {
  return `:root{${themeCssDeclarations(id)}}`;
}
