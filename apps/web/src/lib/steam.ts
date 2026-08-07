// SteamストアAPI連携。APIキー不要で使える公開エンドポイントのみ使用する。

export type SteamSearchResult = {
  appId: number;
  name: string;
  thumbnail: string;
};

/** ゲーム名でSteamストアを検索する（Steamストアの検索窓と同じ公開API） */
export async function searchSteamGames(query: string): Promise<SteamSearchResult[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=japanese&cc=jp`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.items) ? data.items : [];

  return items
    .filter(
      (item): item is { id: number; name: string; tiny_image: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "number"
    )
    .map((item) => ({
      appId: item.id,
      name: item.name,
      thumbnail: item.tiny_image,
    }));
}

/** app IDからストアのヘッダー画像（460x215）のURLを組み立てる */
export function steamHeaderImageUrl(appId: number): string {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

export type SteamReviewSummary = {
  scoreDesc: string;
  totalPositive: number;
  totalNegative: number;
  totalReviews: number;
};

/** レビュー概要（「非常に好評」等の評価とその内訳件数）を取得する */
export async function getSteamReviewSummary(appId: number): Promise<SteamReviewSummary | null> {
  const url = `https://store.steampowered.com/appreviews/${appId}?json=1&language=japanese&purchase_type=all`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const summary = data?.query_summary;
  if (!summary || typeof summary.review_score_desc !== "string") return null;

  return {
    scoreDesc: summary.review_score_desc,
    totalPositive: summary.total_positive ?? 0,
    totalNegative: summary.total_negative ?? 0,
    totalReviews: summary.total_reviews ?? 0,
  };
}

export type SteamPriceInfo = {
  isFree: boolean;
  finalFormatted: string;
  initialFormatted: string | null;
  discountPercent: number;
};

/** 現在の価格・セール状況を取得する（無料ゲーム/非公開ゲームはnull寄りの扱い） */
export async function getSteamPriceInfo(appId: number): Promise<SteamPriceInfo | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const entry = data?.[String(appId)];
  if (!entry?.success) return null;

  const appData = entry.data;
  if (appData?.is_free) {
    return { isFree: true, finalFormatted: "無料", initialFormatted: null, discountPercent: 0 };
  }

  const price = appData?.price_overview;
  if (!price) return null;

  return {
    isFree: false,
    finalFormatted: price.final_formatted,
    initialFormatted: price.discount_percent > 0 ? price.initial_formatted : null,
    discountPercent: price.discount_percent ?? 0,
  };
}

export type SteamNewsItem = {
  id: string;
  title: string;
  url: string;
  date: number; // unix seconds
  contents: string;
};

/** 最新のアプデ/ニュースを取得する。maxlengthは本文の最大文字数（0で無制限） */
export async function getSteamNews(appId: number, count = 3, maxlength = 300): Promise<SteamNewsItem[]> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appId}&count=${count}&maxlength=${maxlength}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.appnews?.newsitems) ? data.appnews.newsitems : [];

  return items
    .filter(
      (item): item is { gid: string; title: string; url: string; date: number; contents?: string } =>
        typeof item === "object" && item !== null && typeof (item as { title?: unknown }).title === "string"
    )
    .map((item) => ({ id: item.gid, title: item.title, url: item.url, date: item.date, contents: item.contents ?? "" }));
}
