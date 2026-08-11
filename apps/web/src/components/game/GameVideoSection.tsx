import { ExternalLink, Youtube } from "lucide-react";

// 関連動画（ゲーム追加時に1回だけ検索してDB保存したもの）の埋め込みとYouTube検索リンク。
// 提案の詳細ページでは、まだ誰もリストに追加していないゲームだと動画IDが無いため
// 検索リンクだけになる。
export function GameVideoSection({
  title,
  youtubeVideoId,
}: {
  title: string;
  youtubeVideoId: string | null;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <Youtube size={12} /> 関連動画
      </h2>
      {youtubeVideoId && (
        <div className="mt-2 aspect-video w-full overflow-hidden rounded-sm border border-steam-border">
          <iframe
            src={`https://www.youtube.com/embed/${youtubeVideoId}`}
            title="関連動画"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}
      <a
        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} gameplay`)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 font-mono text-3xs text-steam-blue hover:underline"
      >
        <ExternalLink size={11} /> YouTubeで他の動画を探す
      </a>
    </div>
  );
}
