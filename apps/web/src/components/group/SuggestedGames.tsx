"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plus, Check } from "lucide-react";
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
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  async function addSuggestion(s: Suggestion) {
    // 即座に「追加済み」表示にし、失敗した時だけ元に戻す
    setAddedIds((prev) => new Set(prev).add(s.appId));
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
      router.refresh();
    } catch (e) {
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(s.appId);
        return next;
      });
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    }
  }

  return (
    <div className="mt-4 border-t border-steam-border pt-4">
      <p className="font-mono text-3xs text-steam-muted">
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
              <div className="relative h-16 w-full">
                <Image src={s.thumbnail} alt={s.name} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
              </div>
              <div className="flex items-center gap-1 p-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-4xs text-steam-text">
                  {s.name}
                </span>
                <button
                  onClick={() => addSuggestion(s)}
                  disabled={added}
                  className="flex-shrink-0 p-1.5 text-steam-muted transition hover:text-steam-blue disabled:opacity-50"
                  aria-label="リストに追加"
                >
                  {added ? <Check size={12} className="text-[#a4d007]" /> : <Plus size={12} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
