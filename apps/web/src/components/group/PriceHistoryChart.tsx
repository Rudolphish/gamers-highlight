import type { PriceHistoryPoint } from "@/lib/itad";

const WIDTH = 340;
const HEIGHT = 140;
const PADDING = { top: 16, right: 10, bottom: 22, left: 54 };
const PLOT_W = WIDTH - PADDING.left - PADDING.right;
const PLOT_H = HEIGHT - PADDING.top - PADDING.bottom;

function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// Steamの価格変動履歴（値動き）を単一系列のステップ折れ線で表示する。
// データは「価格が変わった瞬間」の記録なので、直近の価格を今日まで水平に延長する。
export function PriceHistoryChart({ points }: { points: PriceHistoryPoint[] }) {
  const now = Date.now();
  const startTime = new Date(points[0].timestamp).getTime();
  const timeSpan = Math.max(now - startTime, 1);

  const prices = points.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const margin = maxPrice > minPrice ? (maxPrice - minPrice) * 0.15 : Math.max(maxPrice * 0.1, 100);
  const domainMin = Math.max(minPrice - margin, 0);
  const domainMax = maxPrice + margin;

  const x = (t: number) => PADDING.left + ((t - startTime) / timeSpan) * PLOT_W;
  const y = (price: number) =>
    PADDING.top + PLOT_H - ((price - domainMin) / (domainMax - domainMin)) * PLOT_H;

  // ステップ折れ線: 各点で水平→垂直に折れ、最後は現在時刻まで水平に延長する
  const stepCommands: string[] = [];
  points.forEach((p, i) => {
    const px = x(new Date(p.timestamp).getTime());
    const py = y(p.price);
    if (i === 0) {
      stepCommands.push(`M ${px} ${py}`);
    } else {
      stepCommands.push(`L ${px} ${stepCommands.length > 0 ? y(points[i - 1].price) : py}`);
      stepCommands.push(`L ${px} ${py}`);
    }
  });
  const last = points[points.length - 1];
  stepCommands.push(`L ${x(now)} ${y(last.price)}`);
  const linePath = stepCommands.join(" ");

  const minPoint = points.reduce((a, b) => (b.price < a.price ? b : a));
  const showMinLabel = minPoint.price < last.price;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={`価格推移: 現在${formatYen(last.price)}、期間最安値${formatYen(minPoint.price)}`}
    >
      {/* グリッド線（最大値・最小値） */}
      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={y(domainMax)}
        y2={y(domainMax)}
        stroke="#2f4359"
        strokeWidth={1}
      />
      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={PADDING.top + PLOT_H}
        y2={PADDING.top + PLOT_H}
        stroke="#2f4359"
        strokeWidth={1}
      />
      <text x={PADDING.left - 4} y={y(domainMax) + 3} textAnchor="end" className="fill-steam-muted font-mono text-[8px]">
        {formatYen(maxPrice)}
      </text>
      <text x={PADDING.left - 4} y={PADDING.top + PLOT_H + 3} textAnchor="end" className="fill-steam-muted font-mono text-[8px]">
        {formatYen(minPrice)}
      </text>

      {/* 折れ線本体 */}
      <path d={linePath} fill="none" stroke="#66c0f4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* 各変化点のマーカー */}
      {points.map((p) => (
        <circle
          key={p.timestamp}
          cx={x(new Date(p.timestamp).getTime())}
          cy={y(p.price)}
          r={4}
          fill="#66c0f4"
          stroke="#16202d"
          strokeWidth={2}
        >
          <title>
            {formatShortDate(p.timestamp)}: {formatYen(p.price)}
            {p.cut > 0 ? `（-${p.cut}%）` : ""}
          </title>
        </circle>
      ))}

      {/* 現在価格ラベル */}
      <circle cx={x(now)} cy={y(last.price)} r={4} fill="#66c0f4" stroke="#16202d" strokeWidth={2} />
      <text
        x={Math.min(x(now), WIDTH - PADDING.right - 2)}
        y={y(last.price) - 8}
        textAnchor="end"
        className="fill-steam-text font-mono text-[9px] font-bold"
      >
        現在 {formatYen(last.price)}
      </text>

      {/* 期間最安値ラベル（現在価格と異なる場合のみ） */}
      {showMinLabel && (
        <text
          x={x(new Date(minPoint.timestamp).getTime())}
          y={y(minPoint.price) + 14}
          textAnchor="middle"
          className="fill-steam-muted font-mono text-[8px]"
        >
          最安 {formatYen(minPoint.price)}
        </text>
      )}

      {/* X軸: 期間の始点と「現在」 */}
      <text x={PADDING.left} y={HEIGHT - 4} textAnchor="start" className="fill-steam-muted font-mono text-[8px]">
        {formatShortDate(points[0].timestamp)}
      </text>
      <text x={WIDTH - PADDING.right} y={HEIGHT - 4} textAnchor="end" className="fill-steam-muted font-mono text-[8px]">
        現在
      </text>
    </svg>
  );
}
