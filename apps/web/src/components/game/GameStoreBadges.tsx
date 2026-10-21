import type { GameDetailData } from "@/lib/gameDetail";
import { badge } from "@/components/ui/buttonStyles";

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
        <span className={badge("positive")}>
          {reviews.scoreDesc}（{reviews.totalReviews.toLocaleString()}件）
        </span>
      )}
      {price && (
        <span className={`${badge("neutral")} font-num`}>
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
