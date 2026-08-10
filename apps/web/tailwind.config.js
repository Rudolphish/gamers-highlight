/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        steam: {
          bg: "#1b2838",
          panel: "#171a21",
          surface: "#16202d",
          border: "#2f4359",
          text: "#c7d5e0",
          muted: "#8f98a0",
          blue: "#66c0f4",
        },
      },
      // text-[10px] のような px 直書きはルート font-size のスケールに追従しないため、
      // xs より小さいサイズも rem ベースのトークンとして定義しておく。
      fontSize: {
        "2xs": "0.6875rem", // 11px 相当
        "3xs": "0.625rem", // 10px 相当
        "4xs": "0.5625rem", // 9px 相当
      },
      fontFamily: {
        display: ["Rajdhani", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        "route-progress": {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(20%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "route-progress": "route-progress 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
