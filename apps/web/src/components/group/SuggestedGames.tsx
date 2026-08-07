"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { translateGenre } from "@/lib/steam";

type Suggestion = { appId: number; name: string; thumbnail: string };

// グループの既存ゲームで一番多いジャンルから、Steamストアの人気ゲームを簡易サジェストする
// （ルールベース。roadmap.md Phase 6「サジェスト機能」参照）。
export function SuggestedGames({
  groupId,
  genre,
  suggestions,
}: {
  groupId: string;
  genre: string;
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  async function addSuggestion(s: Suggestion) {
    setAddingId(s.appId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: s.appId,
          title: s.name,
          coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${s.appId}/header.jpg`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "追加に失敗しました");
      }
      setAddedIds((prev) => new Set(prev).add(s.appId));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="mt-4 border-t border-steam-border pt-4">
      <p className="font-mono text-[10px] text-steam-muted">
        よく遊んでいる「{translateGenre(genre)}」ジャンルから
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {suggestions.map((s) => {
          const added = addedIds.has(s.appId);
          return (
            <div
              key={s.appId}
              className="overflow-hidden rounded-sm border border-steam-border bg-steam-panel"
            >
              <img src={s.thumbnail} alt={s.name} className="h-16 w-full object-cover" />
              <div className="flex items-center gap-1 p-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-steam-text">
                  {s.name}
                </span>
                <button
                  onClick={() => addSuggestion(s)}
                  disabled={addingId !== null || added}
                  className="flex-shrink-0 text-steam-muted transition hover:text-steam-blue disabled:opacity-50"
                  aria-label="リストに追加"
                >
                  {added ? (
                    <Check size={12} className="text-[#a4d007]" />
                  ) : addingId === s.appId ? (
                    <Spinner size={12} />
                  ) : (
                    <Plus size={12} />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 font-mono text-[10px] text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
