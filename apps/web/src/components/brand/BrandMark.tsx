"use client";

import { useId } from "react";
import { useNavLoadingPhase } from "@/components/layout/navLoading";

// ロゴのマーク（favicon の M1 と同じ形。docs/design/favicon.md）。
// 奥の2枚の板・手前の光る板・「S」に分けてあるのは、読み込み中に動かすため（docs/design/loading.md）。
// 動きは globals.css の `.brand-mark`。`animate` のときだけ板が扇に開く（候補 A）。
//
// **板の色はテーマで変わる**（CSS 変数。値は src/lib/themeColors.ts）。SVG の属性（stopColor・fill）には
// var() を書けないので style で渡す。「S」はどのテーマでも同じ色。
//
// グラデーションとフィルタの id は1ページに何個置いても衝突しないよう useId から作る
// （同じ id が2つあると、後から置いたマークが先のマークの定義を参照して色が崩れる）
export function BrandMark({ size, animate = false, className = "" }: { size: number; animate?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sl = `bm-sl-${id}`;
  const sr = `bm-sr-${id}`;
  const f = `bm-f-${id}`;
  const glow = `bm-glow-${id}`;
  const glow2 = `bm-glow2-${id}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={`brand-mark flex-shrink-0 overflow-visible ${className}`}
      data-animate={animate ? "true" : "false"}
    >
      <defs>
        <linearGradient id={sl} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--mark-plate-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--mark-plate-b)" }} />
        </linearGradient>
        <linearGradient id={sr} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--mark-back-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--mark-back-b)" }} />
        </linearGradient>
        <linearGradient id={f} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--mark-hi)" }} />
          <stop offset="1" style={{ stopColor: "var(--mark-lo)" }} />
        </linearGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <filter id={glow2} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <rect className="bm-l" x="4" y="27" width="30" height="23" rx="5" fill={`url(#${sl})`} />
      <rect className="bm-r" x="30" y="27" width="30" height="23" rx="5" fill={`url(#${sr})`} />
      <g className="bm-front">
        <rect className="bm-glow" x="13" y="10.5" width="38" height="33" rx="6.5" opacity=".7" filter={`url(#${glow})`} style={{ fill: "rgb(var(--accent))" }} />
        <rect x="13" y="10.5" width="38" height="33" rx="6.5" fill={`url(#${f})`} />
        <rect x="13" y="10.5" width="38" height="33" rx="6.5" fill="none" strokeWidth="2.2" filter={`url(#${glow2})`} style={{ stroke: "var(--mark-rim)" }} />
        <rect x="13" y="10.5" width="38" height="33" rx="6.5" fill="none" strokeWidth="1.1" style={{ stroke: "var(--mark-rim2)" }} />
        <path
          d="M42 18H26.5A4.5 4.5 0 0 0 22 22.5v0A4.5 4.5 0 0 0 26.5 27h11A4.5 4.5 0 0 1 42 31.5v0A4.5 4.5 0 0 1 37.5 36H22"
          fill="none"
          stroke="#0b1218"
          strokeWidth="6.5"
          strokeLinecap="square"
        />
      </g>
    </svg>
  );
}

/** ロゴの横に置くマーク。画面を移っている間（0.3秒を超えたら）だけ動く */
export function LiveBrandMark({ size, className }: { size: number; className?: string }) {
  const phase = useNavLoadingPhase();
  return <BrandMark size={size} animate={phase !== "idle"} className={className} />;
}
