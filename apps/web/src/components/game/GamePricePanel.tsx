import { ExternalLink, TrendingDown } from "lucide-react";
import type { GameDetailData } from "@/lib/gameDetail";

// 現在価格（Steam）と過去最安値（IsThereAnyDeal）を並べる。
// ゲーム詳細ページと提案の詳細ページで共通。
export function GamePricePanel({
  price,
  itad,
}: {
  price: GameDetailData["price"];
  itad: GameDetailData["itad"];
}) {
  if (!itad) return null;

  return (
    <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <TrendingDown size={12} /> 価格情報
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-sm border border-steam-border bg-steam-panel p-3 text-center">
          <p className="font-mono text-4xs text-steam-muted">現在価格（Steam）</p>
          <p className="mt-1 font-display text-lg font-bold text-steam-text">
            {price ? (price.isFree ? "無料" : price.finalFormatted) : "-"}
          </p>
        </div>
        <div className="rounded-sm border border-steam-border bg-steam-panel p-3 text-center">
          <p className="font-mono text-4xs text-steam-muted">過去最安値（全ストア）</p>
          <p className="mt-1 font-display text-lg font-bold text-[#a4d007]">
            ¥{itad.lowPrice.toLocaleString("ja-JP")}
          </p>
          <p className="font-mono text-4xs text-steam-muted/70">
            {itad.lowShopName}
            {itad.lowCut > 0 ? `（-${itad.lowCut}%）` : ""}
          </p>
        </div>
      </div>
      <a
        href={itad.pageUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 font-mono text-3xs text-steam-blue hover:underline"
      >
        <ExternalLink size={11} /> IsThereAnyDealで全ストアの価格を比較する
      </a>
    </div>
  );
}
