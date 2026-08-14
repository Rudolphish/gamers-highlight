// SteamストアAPI連携。APIキー不要で使える公開エンドポイントのみ使用する。

/**
 * ゲーム1件分の外部データにまとめて付けるキャッシュタグ。
 * リフレッシュ時に revalidateTag(gameCacheTag(appId)) で一括無効化する。
 */
export function gameCacheTag(appId: number): string {
  return `game-${appId}`;
}

/**
 * ゲーム詳細ページで毎回描画される情報（レビュー・価格・ニュース）用のfetchオプション。
 *
 * Next.js 14のApp Routerではオプション無しの`fetch`は既定でキャッシュされる（force-cache）ため、
 * 何も指定しないと**一度取得した価格やレビューが更新されないまま固定される**。
 * 実際にこのリポジトリは全ての外部fetchが無指定で、価格が古いまま出ていた。
 * 明示的な再検証期間を与えたうえでタグを付け、手動リフレッシュでも飛ばせるようにする。
 */
export function gameFetchOptions(appId: number): RequestInit {
  return { next: { revalidate: 60 * 60 * 6, tags: [gameCacheTag(appId)] } };
}

/**
 * ゲーム追加時・手動リフレッシュ時にしか呼ばれない問い合わせ用。
 * これらは毎回の描画では走らないためキャッシュする意味が無く、むしろキャッシュされると
 * 「リフレッシュしたのに古い値が返る」ことになるので明示的に無効化する。
 */
const NO_STORE: RequestInit = { cache: "no-store" };

export type SteamSearchResult = {
  appId: number;
  name: string;
  thumbnail: string;
};

/** ゲーム名でSteamストアを検索する（Steamストアの検索窓と同じ公開API） */
export async function searchSteamGames(query: string): Promise<SteamSearchResult[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=japanese&cc=jp`;
  const res = await fetch(url, NO_STORE);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.items) ? data.items : [];

  // storesearchはゲーム（type: "app"）以外に、パッケージ（"sub"）やバンドル（"bundle"）も返す。
  // これらのidはapp IDではないため、そのまま採用するとsteamAppIdに別体系のIDが入り、
  // 以降が軒並み壊れる：
  //   - カバー画像 steam/apps/<id>/header.jpg が404（subの画像は steam/subs/<id>/... にある）
  //   - appdetailsが success:false になりジャンル・価格が取れない
  //   - レビュー0件、ニュース無し、ITAD/HowLongToBeatの紐付けも不可
  // 検索モーダル上はAPIが返すtiny_imageを表示するのでサムネイルは正常に見え、
  // 「追加した後だけ画像が壊れる」という分かりにくい形で出る（実際に発生した）。
  return items
    .filter(
      (item): item is { id: number; name: string; tiny_image: string; type: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "number" &&
        (item as { type?: unknown }).type === "app"
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
  const res = await fetch(url, gameFetchOptions(appId));
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
  const res = await fetch(url, gameFetchOptions(appId));
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
  const res = await fetch(url, gameFetchOptions(appId));
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

export type SteamAppSummary = {
  /** ジャンル（英語の正規名。例: "Action", "RPG"）。検索・サジェストの照合キーとして使う */
  genres: string[];
  /** ストアのヘッダー画像URL。steamHeaderImageUrl()の推測ではなくAPIが返す正しい値 */
  headerImage: string | null;
  /**
   * 英語の正式タイトル。`GroupGame.title`は日本語検索（`l=japanese`）由来の日本語名なので、
   * 英語タイトル前提の外部サービス（HowLongToBeat）を引くときはこちらを使う。
   * 取得できなければnull。
   */
  name: string | null;
};

/**
 * ゲームの基本情報をappdetailsから1回の問い合わせでまとめて取る。
 *
 * headerImageを必ずここから取るのが肝心：steamHeaderImageUrl()が組み立てる
 * `steam/apps/<id>/header.jpg` という固定パスは、Steamがアセットを
 * `store_item_assets/steam/apps/<id>/<コンテンツハッシュ>/header.jpg` に移した結果、
 * **新しめのタイトルでは404になる**（さらにGRAIN ROTのようにファイル名が
 * header_alt_assets_0.jpg のケースもあり、パスを推測しきることはできない）。
 * 古いタイトルでは旧パスが今も通るため「一部のゲームだけ画像が出ない」という
 * 分かりにくい形で出る（実際に発生した）。
 */
export async function getSteamAppSummary(appId: number): Promise<SteamAppSummary> {
  const empty: SteamAppSummary = { genres: [], headerImage: null, name: null };
  // `l`を付けないので英語の値が返る（genresの英語名とnameの英語タイトルはこれが前提）
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp`;
  const res = await fetch(url, NO_STORE);
  if (!res.ok) return empty;

  const data = await res.json();
  const entry = data?.[String(appId)];
  if (!entry?.success) return empty;

  const rawGenres: unknown[] = Array.isArray(entry.data?.genres) ? entry.data.genres : [];
  const genres = rawGenres
    .filter(
      (g): g is { description: string } =>
        typeof g === "object" && g !== null && typeof (g as { description?: unknown }).description === "string"
    )
    .map((g) => g.description);

  const headerImage =
    typeof entry.data?.header_image === "string" && entry.data.header_image.startsWith("https://")
      ? entry.data.header_image
      : null;

  const name =
    typeof entry.data?.name === "string" && entry.data.name.trim().length > 0
      ? entry.data.name.trim()
      : null;

  return { genres, headerImage, name };
}

/** ジャンルだけが欲しい場合の薄いラッパー */
export async function getSteamGenres(appId: number): Promise<string[]> {
  return (await getSteamAppSummary(appId)).genres;
}

/**
 * 日本語のタイトルだけを引く。スクショのファイル名から判別したapp IDを
 * 画面に出す名前へ変える用途に使う。
 *
 * `l=japanese` を付けているのは、`GroupGame.title`（日本語検索由来）と
 * 見た目を揃えるため。英語名が要る場面（HowLongToBeat）とは用途が違う。
 *
 * アプリが既に知っているゲームなら呼ばれない（DBの値で足りる）。ここに来るのは
 * 未登録のゲームだけなので、タイトル名は変わらない前提で1日キャッシュする。
 */
export async function getSteamAppNameJa(appId: number): Promise<string | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=jp&l=japanese`;
  const res = await fetch(url, {
    next: { revalidate: 60 * 60 * 24, tags: [gameCacheTag(appId)] },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const entry = data?.[String(appId)];
  // type が "game" 以外（DLC・サントラ等）は、スクショのタグとしては使えても
  // 紛らわしいので弾かない。判別できた事実の方が有用なため。
  if (!entry?.success) return null;

  const name = entry.data?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
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
  const res = await fetch(url, gameFetchOptions(appId));
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
