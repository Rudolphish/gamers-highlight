import {
  recordApiUsage,
  usedUnitsToday,
  YOUTUBE_SEARCH_UNITS,
  YOUTUBE_DAILY_QUOTA,
} from "./apiUsage";

// YouTube Data API v3連携。search.listは1回あたりクォータ100（無料枠1日10,000＝実質100回/日）を
// 消費するため、ページ表示のたびには呼ばず、ゲームをリストに追加する時に1回だけ検索して結果をDBに保存する。
//
// 消費量は管理者ページで見えるようにApiUsageへ記録する。`cache: "no-store"`で
// 必ず実際に外部へ出るため、ここで数えた回数と実消費が一致する。

export type YoutubeVideo = {
  videoId: string;
  title: string;
};

/**
 * 今日の消費がこれを超えていたら、埋め直し目的の検索は行わない。
 *
 * 埋まっていない項目の再取得（lib/externalGameCache.ts）は本人が待っている操作ではないので、
 * ユーザーがゲームを追加したときのぶんを食い潰さないよう、枠の半分で止める。
 * ユーザー操作からの取得には上限を渡さない（枠が残っている限り通る）。
 */
export const YOUTUBE_BACKFILL_BUDGET = YOUTUBE_DAILY_QUOTA / 2;

/**
 * ゲームタイトルの実況/プレイ動画を1件検索する。キー未設定/失敗時はnull。
 *
 * `budgetUnits` を渡すと、今日の消費がその値を超えている場合は問い合わせ自体を行わない。
 */
export async function getGameplayVideo(
  title: string,
  budgetUnits?: number
): Promise<YoutubeVideo | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

  // クォータを使い切っていれば呼んでも403が返るだけなので、その手前で止める。
  // 無駄な1回でも記録上は消費として残り、原因追跡のノイズになる。
  const limit = Math.min(budgetUnits ?? YOUTUBE_DAILY_QUOTA, YOUTUBE_DAILY_QUOTA);
  const used = await usedUnitsToday("youtube");
  if (used + YOUTUBE_SEARCH_UNITS > limit) {
    console.warn(`[youtube] skipped search: used=${used} limit=${limit} title=${JSON.stringify(title)}`);
    return null;
  }

  try {
    const q = encodeURIComponent(`${title} gameplay`);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&maxResults=1&order=relevance&key=${key}`;
    // 追加時・手動リフレッシュ時にしか呼ばないので、キャッシュされると
    // 「リフレッシュしたのに同じ動画が返る」ことになる。明示的に無効化する
    const res = await fetch(url, { cache: "no-store" });
    // 結果の成否によらずクォータは消費される（エラー応答でも引かれる）ので、
    // 中身を見る前に記録する
    await recordApiUsage("youtube", YOUTUBE_SEARCH_UNITS);
    if (!res.ok) return null;

    const data = await res.json();
    const item = data?.items?.[0];
    const videoId = item?.id?.videoId;
    const videoTitle = item?.snippet?.title;
    if (typeof videoId !== "string" || typeof videoTitle !== "string") return null;

    return { videoId, title: videoTitle };
  } catch {
    return null;
  }
}
