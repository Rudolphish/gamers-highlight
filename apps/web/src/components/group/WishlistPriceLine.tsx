import { formatYen, type WishlistPrice } from "@/lib/wishlistPrice";

/**
 * カードの価格。**2行に分ける**（2026-10-21 ユーザー判断。2案から選んだ）:
 *   現在：~~¥1,900~~ ¥1,615 (-15%)
 *   最安：¥1,615 [最安値]
 * 以前は「¥1,615 -15% · 最安 ¥1,615 最安値」の1行で、今の値段と元の値段がぱっと見で分からなかった。
 * 1行のままだと、セール中は幅300pxのカードで最安値の部分が切れる。
 * 最安値はSteamだけのもの（lib/itad.ts の getSteamStoreLow）。取れなかった行は出さない。
 * 各部分は**1つの文字列として描く**（Reactは隣り合うテキストを区切り、テストから拾えなくなる。docs/lessons.md）
 */
export function PriceLine({ price }: { price: WishlistPrice | "loading" | undefined }) {
  if (price === "loading") {
    return <p className="text-4xs text-steam-muted/50">…</p>;
  }
  if (!price) return null;
  const now = price.isFree ? "無料" : price.price !== null ? formatYen(price.price) : null;
  const row = "flex items-center gap-1.5 overflow-hidden whitespace-nowrap";
  return (
    <div data-testid="wishlist-price" className="flex flex-col gap-0.5 font-num text-3xs">
      {now && (
        <p data-testid="wishlist-price-now" className={row}>
          <span className="flex-shrink-0 text-steam-muted">現在：</span>
          {price.originalPrice !== null && (
            <s className="flex-shrink-0 text-steam-muted">{formatYen(price.originalPrice)}</s>
          )}
          <span className="flex-shrink-0 font-bold text-steam-text">{now}</span>
          {price.discountPercent > 0 && <span className="truncate font-bold text-positive">{`(-${price.discountPercent}%)`}</span>}
        </p>
      )}
      {price.steamLow !== null && (
        <p data-testid="wishlist-price-low" className={row}>
          <span className="flex-shrink-0 text-steam-muted">最安：</span>
          <span className="truncate text-steam-text">{formatYen(price.steamLow)}</span>
          {price.atLow && (
            <span className="flex-shrink-0 rounded-full bg-positive/15 px-1.5 font-bold text-positive">最安値</span>
          )}
        </p>
      )}
    </div>
  );
}
