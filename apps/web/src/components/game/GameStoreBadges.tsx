import type { GameDetailData } from "@/lib/gameDetail";

// レビュー評価と現在価格のバッジ。ステータス等のページ固有のバッジは
// 呼び出し側が同じflexコンテナ内でこれより前に置く。
export function GameStoreBadges({
  reviews,
  price,
}: {
  reviews: GameDetailData["reviews"];
  price: GameDetailData["price"];
}) {
  return (
    <>
      {reviews && (
        <span className="rounded-sm border border-[#a4d007]/50 px-1.5 py-0.5 font-mono text-3xs text-[#a4d007]">
          {reviews.scoreDesc}（{reviews.totalReviews.toLocaleString()}件）
        </span>
      )}
      {price && (
        <span className="rounded-sm border border-steam-border px-1.5 py-0.5 font-mono text-3xs text-steam-text">
          {price.isFree
            ? "無料"
            : price.discountPercent > 0
              ? `${price.finalFormatted}（-${price.discountPercent}%）`
              : price.finalFormatted}
        </span>
      )}
    </>
  );
}
