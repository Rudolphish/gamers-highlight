import { recordApiUsage, YOUTUBE_SEARCH_UNITS } from "./apiUsage";

// YouTube Data API v3連携。search.listは1回あたりクォータ100（無料枠1日10,000＝実質100回/日）を
// 消費するため、ページ表示のたびには呼ばず、ゲームをリストに追加する時に1回だけ検索して結果をDBに保存する。
//
// 消費量は管理者ページで見えるようにApiUsageへ記録する。`cache: "no-store"`で
// 必ず実際に外部へ出るため、ここで数えた回数と実消費が一致する。

export type YoutubeVideo = {
  videoId: string;
  title: string;
};

/** ゲームタイトルの実況/プレイ動画を1件検索する。キー未設定/失敗時はnull */
export async function getGameplayVideo(title: string): Promise<YoutubeVideo | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

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
