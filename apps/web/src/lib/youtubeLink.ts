// ユーザーが貼ったYouTubeのURLを、保存できる形に正規化する。
//
// **外部APIは一切叩かない。** 埋め込み（iframe）もサムネイルも、動画IDが分かれば
// URLを組み立てるだけで出せる。YouTube Data API を使うのはタイトルや長さが欲しいときだけで、
// それらが無くても投稿は成立するので、クォータにも通信の失敗にも依存させない。
// （`lib/youtube.ts` の search.list は1回100ユニット。あれとは別の話）
//
// **サムネイルのURLは組み立ててよい。** Steamのヘッダー画像は組み立てると404になるので
// `CLAUDE.md` で禁じているが、YouTubeの `i.ytimg.com/vi/<id>/hqdefault.jpg` は
// 動画IDだけで決まる公開の仕様で、ハッシュ等が入らない。

/** 動画ID。YouTubeの仕様で11文字の英数字と `-` `_` */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export type YoutubeLink = {
  videoId: string;
  /** 保存する正規形。ユーザーが貼ったURLの再生位置やプレイリストは落とす */
  canonicalUrl: string;
  /** 埋め込み用。nocookie ドメインを使う（視聴しただけでCookieを置かれないように） */
  embedUrl: string;
  /** サムネイル。公開動画なら必ず存在する */
  thumbnailUrl: string;
};

/**
 * YouTubeのURLから動画IDを取り出す。YouTubeのURLでなければ null。
 *
 * 受け付ける形（実際に貼られる形を全部通す。どれか1つでも弾くと
 * 「共有ボタンで出たURLが使えない」になる）:
 *   https://www.youtube.com/watch?v=ID  … PCの共有
 *   https://youtu.be/ID                 … 共有ボタンの短縮形
 *   https://www.youtube.com/shorts/ID   … Shorts
 *   https://www.youtube.com/embed/ID    … 埋め込みコードからのコピー
 *   https://m.youtube.com/watch?v=ID    … スマホのブラウザ
 * `?t=90` や `&list=...` が付いていても落として正規形にする。
 */
export function parseYoutubeUrl(input: unknown): YoutubeLink | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let url: URL;
  try {
    // スキーマを省いて貼られることがある（youtu.be/xxxx）
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // http/https 以外は弾く（`javascript:` などを通さないため）。
  // httpで貼られても構わない——保存するのは下の `linkFor` が組み立てる https のURLなので、
  // 混在コンテンツで埋め込みがブロックされることはない
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const path = url.pathname.replace(/^\/+/, "");
  const segments = path.split("/");

  let id: string | null = null;
  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    id = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    id = url.searchParams.get("v");
  } else if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") {
    id = segments[1] ?? null;
  }

  if (!id || !VIDEO_ID.test(id)) return null;
  return linkFor(id);
}

/** 保存済みのURL（正規形）から埋め込み用の値を作り直す */
export function youtubeLinkFromStored(mediaUrl: string): YoutubeLink | null {
  return parseYoutubeUrl(mediaUrl);
}

function linkFor(videoId: string): YoutubeLink {
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
