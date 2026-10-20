import { MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import type { SteamReviewItem } from "@/lib/steam";

// Steamの実際のレビュー本文を数件並べる。
// ゲーム詳細ページと提案の詳細ページで共通。
export function GameReviewsPanel({ reviews }: { reviews: SteamReviewItem[] }) {
  if (reviews.length === 0) return null;

  return (
    <div className="rounded-xl bg-steam-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <MessageSquare size={12} /> レビュー
      </h2>
      <div className="mt-2 flex flex-col gap-3">
        {reviews.map((r) => (
          <div key={r.id} className="border-t border-steam-border pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-1.5 text-4xs text-steam-muted">
              {r.votedUp ? (
                <ThumbsUp size={11} className="text-positive" />
              ) : (
                <ThumbsDown size={11} className="text-danger" />
              )}
              <span>プレイ時間 {r.playtimeHours}h</span>
              <span>・{new Date(r.createdAt * 1000).toLocaleDateString("ja-JP")}</span>
            </div>
            <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-steam-text">
              {r.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
