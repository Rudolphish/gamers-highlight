// ウィッシュリストのカードに出す価格（Steamの今の値段と、Steamでの過去最安値）。
// 取ってくるのは /api/groups/:id/proposals/prices、出すのは components/group/GameProposals.tsx。
// ここは画面からも読むので、サーバー専用のものを import しない。

export type WishlistPrice = {
  /** 今の値段（円）。無料は0、取れなければnull */
  price: number | null;
  isFree: boolean;
  discountPercent: number;
  /** 割引前の値段（円）。割引中で、今の値段より高いときだけ入る（取り消し線を付けて出す） */
  originalPrice: number | null;
  /** Steamでの過去最安値（円）。取れなければnull */
  steamLow: number | null;
  /** 今の値段が過去最安値と同じかそれより安い（「最安値」の印を出す） */
  atLow: boolean;
};

/** 取ってきた2つをカード用にまとめる。どちらも無ければ null（カードに価格の行を出さない） */
export function toWishlistPrice(
  steam: { isFree: boolean; discountPercent: number; finalAmount: number | null; initialAmount?: number | null } | null,
  steamLow: number | null
): WishlistPrice | null {
  const price = steam ? (steam.isFree ? 0 : steam.finalAmount) : null;
  if (price === null && steamLow === null) return null;
  const isFree = steam?.isFree ?? false;
  const discountPercent = isFree ? 0 : (steam?.discountPercent ?? 0);
  const initial = steam?.initialAmount ?? null;
  return {
    price,
    isFree,
    discountPercent,
    originalPrice: discountPercent > 0 && initial !== null && price !== null && initial > price ? initial : null,
    steamLow,
    atLow: !isFree && price !== null && steamLow !== null && price <= steamLow,
  };
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}
