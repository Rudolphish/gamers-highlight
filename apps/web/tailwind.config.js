const JP_SANS = [
  "Noto Sans JP",
  "Hiragino Sans",
  "Hiragino Kaku Gothic ProN",
  "Yu Gothic UI",
  "Meiryo",
  "system-ui",
  "sans-serif",
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // **名前は Steam 風だった頃のまま、値だけ新しい配色にしてある**（デザイン刷新の段階1）。
        // 名前を変えると全画面（約1,400か所）の書き換えになるので、まず値だけ差し替えた。
        // 面は「背景 < surface < panel」の順に明るい（入れ子にしたとき内側が浮いて見えるように）。
        // 文字の色はどの面の上でも明るさの差が 4.5:1 以上になる値にしてある（muted は 6.8:1 以上）
        steam: {
          bg: "#11161d",
          panel: "#1d2631",
          surface: "#18202a",
          border: "#263241",
          text: "#dde5ec",
          muted: "#a3afba",
          blue: "#5ab0ea",
        },
        // 目立たせる色は青1つ（押せるもの・選ばれているもの）。ink はその上に載せる文字
        accent: { DEFAULT: "#5ab0ea", ink: "#0b1218" },
        // 緑は「安い・お得・うまくいった」の意味だけに使う（目立たせるための色にはしない）
        positive: "#7cc96b",
        danger: "#ef6461",
        warning: "#e3a83a",
      },
      // text-[10px] のような px 直書きはルート font-size のスケールに追従しないため、
      // xs より小さいサイズも rem ベースのトークンとして定義しておく。
      //
      // **いちばん小さい文字は12px。** 以前は 2xs=11px・3xs=10px・4xs=9px で、補助の文字が読みにくかった
      // （デザイン刷新の段階1）。名前は全画面で使われているので残し、値を12pxに揃えた
      fontSize: {
        "2xs": "0.75rem",
        "3xs": "0.75rem",
        "4xs": "0.75rem",
      },
      // 日本語は Noto Sans JP。読み込めないときは各端末の標準の日本語フォントになる。
      // Rajdhani は日本語の文字を持たないので、ロゴ（ShareStaq の英字）だけに使う
      fontFamily: {
        sans: JP_SANS,
        display: JP_SANS,
        logo: ["Rajdhani", ...JP_SANS],
        mono: ["JetBrains Mono", ...JP_SANS],
      },
      keyframes: {
        "route-progress": {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(20%)" },
          "100%": { transform: "translateX(100%)" },
        },
        // 読み込み中のプレースホルダ。点滅より横に流れる方が「進んでいる」感じが出る
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "route-progress": "route-progress 1s ease-in-out infinite",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
