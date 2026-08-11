import {
  getSteamNews,
  getSteamPriceInfo,
  getSteamReviews,
  getSteamReviewSummary,
  stripSteamBBCode,
  type SteamNewsItem,
  type SteamPriceInfo,
  type SteamReviewItem,
  type SteamReviewSummary,
} from "./steam";
import { getItadSummary } from "./itad";

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export type GameDetailData = {
  reviews: SteamReviewSummary | null;
  reviewItems: SteamReviewItem[];
  price: SteamPriceInfo | null;
  news: SteamNewsItem[];
  itad: Awaited<ReturnType<typeof getItadSummary>>;
};

/**
 * steamAppIdだけで引ける「描画のたびに取る」外部情報をまとめて取得する。
 * ゲーム詳細ページと提案の詳細ページで共通。
 *
 * いずれも外部サービス依存のため`allSettled`で個別に握りつぶし、
 * 1つ落ちてもページ全体は壊さずそのセクションだけ非表示にする。
 */
export async function loadGameDetailData(steamAppId: number): Promise<GameDetailData> {
  const [reviewResult, reviewItemsResult, priceResult, newsResult, itadResult] =
    await Promise.allSettled([
      getSteamReviewSummary(steamAppId),
      getSteamReviews(steamAppId, 3),
      getSteamPriceInfo(steamAppId),
      getSteamNews(steamAppId, 3, 4000),
      getItadSummary(steamAppId),
    ]);

  return {
    reviews: settled(reviewResult),
    reviewItems: settled(reviewItemsResult) ?? [],
    price: settled(priceResult),
    news: settled(newsResult) ?? [],
    itad: settled(itadResult),
  };
}

/**
 * SteamニュースのcontentsはBBCode/HTMLタグが混じるため、そのまま描画せず
 * タグ類を除去したプレーンテキストの段落配列に変換する（XSS対策）。
 */
export function newsContentToParagraphs(raw: string): string[] {
  return stripSteamBBCode(raw)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
