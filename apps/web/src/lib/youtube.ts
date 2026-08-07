// YouTube Data API v3連携。search.listは1回あたりクォータ100（無料枠1日10,000＝実質100回/日）を
// 消費するため、ページ表示のたびには呼ばず、ゲームをリストに追加する時に1回だけ検索して結果をDBに保存する。

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
    const res = await fetch(url);
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
