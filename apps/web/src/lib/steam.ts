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

/** Steamのレビュー/ニュース本文に混じるBBCode/HTMLタグを除去してプレーンテキスト化する（XSS対策も兼ねる） */
export function stripSteamBBCode(raw: string): string {
  return raw
    .replace(/\[img\][^[]*\[\/img\]/gi, "")
    .replace(/\[url=[^\]]*\]/gi, "")
    .replace(/\[\/url\]/gi, "")
    .replace(/\[\*\]/gi, "・")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export type SteamReviewItem = {
  id: string;
  votedUp: boolean;
  text: string;
  playtimeHours: number;
  createdAt: number; // unix seconds
};

/**
 * 実際のレビュー本文を数件取得する（language指定で言語を絞り込むが、Steam側の判定は
 * 完全ではなく稀に他言語が混じることがある）。
 */
export async function getSteamReviews(
  appId: number,
  count = 3,
  language = "japanese"
): Promise<SteamReviewItem[]> {
  const url = `https://store.steampowered.com/appreviews/${appId}?json=1&language=${language}&purchase_type=all&filter=recent&num_per_page=${count}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.reviews) ? data.reviews : [];

  return items
    .filter(
      (item): item is {
        recommendationid: string;
        voted_up: boolean;
        review: string;
        timestamp_created: number;
        author?: { playtime_forever?: number };
      } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { review?: unknown }).review === "string"
    )
    .map((item) => ({
      id: item.recommendationid,
      votedUp: item.voted_up,
      text: stripSteamBBCode(item.review),
      playtimeHours: Math.round(((item.author?.playtime_forever ?? 0) / 60) * 10) / 10,
      createdAt: item.timestamp_created,
    }))
    .filter((item) => item.text.length > 0);
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

// Steamの英語ジャンル名（appdetailsの標準表記）→ 日本語表示ラベル。
// マップに無いジャンルはそのまま英語表記で表示する（フォールバック）。
export const GENRE_LABEL_JA: Record<string, string> = {
  Action: "アクション",
  Adventure: "アドベンチャー",
  Casual: "カジュアル",
  "Early Access": "早期アクセス",
  "Free to Play": "基本プレイ無料",
  Indie: "インディー",
  "Massively Multiplayer": "MMO",
  RPG: "RPG",
  Racing: "レース",
  Simulation: "シミュレーション",
  Sports: "スポーツ",
  Strategy: "ストラテジー",
  "Game Development": "ゲーム開発",
};

export function translateGenre(genre: string): string {
  return GENRE_LABEL_JA[genre] ?? genre;
}

/** ジャンル（英語の正規名。例: "Action", "RPG"）を取得する。検索・サジェストの照合キーとして使う */
export async function getSteamGenres(appId: number): Promise<string[]> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const entry = data?.[String(appId)];
  if (!entry?.success) return [];

  const genres: unknown[] = Array.isArray(entry.data?.genres) ? entry.data.genres : [];
  return genres
    .filter(
      (g): g is { description: string } =>
        typeof g === "object" && g !== null && typeof (g as { description?: unknown }).description === "string"
    )
    .map((g) => g.description);
}

export type SteamGenreSearchResult = {
  appId: number;
  name: string;
  thumbnail: string;
};

/**
 * ジャンル名（getSteamGenresが返す英語表記、例: "Action"）でSteamストアの人気ゲームを検索する。
 * ストア検索ページが内部で使う軽量エンドポイントを使用（APIキー不要）。
 * レスポンスにapp IDが含まれないため、サムネイル画像URLのパスから抽出する。
 */
export async function searchSteamByGenre(genre: string, count = 10): Promise<SteamGenreSearchResult[]> {
  const url = `https://store.steampowered.com/search/results/?query&genre=${encodeURIComponent(genre)}&cc=jp&l=japanese&json=1`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.items) ? data.items : [];

  const results: SteamGenreSearchResult[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { name, logo } = item as { name?: unknown; logo?: unknown };
    if (typeof name !== "string" || typeof logo !== "string") continue;
    const match = logo.match(/\/apps\/(\d+)\//);
    if (!match) continue;
    results.push({ appId: Number(match[1]), name, thumbnail: logo });
    if (results.length >= count) break;
  }
  return results;
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
