"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X, Search, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type GameStatus = "WISHLIST" | "PLAYING" | "BACKLOG" | "COMPLETED";

type GroupGameItem = {
  id: string;
  steamAppId: number;
  title: string;
  coverUrl: string | null;
  status: GameStatus;
  addedByName: string;
};

type SteamResult = { appId: number; name: string; thumbnail: string };

const STATUS_LABEL: Record<GameStatus, string> = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
};

const STATUS_BADGE_CLASS: Record<GameStatus, string> = {
  WISHLIST: "border-steam-blue/50 text-steam-blue",
  PLAYING: "border-[#a4d007]/50 text-[#a4d007]",
  BACKLOG: "border-[#e0a323]/50 text-[#e0a323]",
  COMPLETED: "border-steam-muted/50 text-steam-muted",
};

const STATUS_ORDER: GameStatus[] = ["PLAYING", "WISHLIST", "BACKLOG", "COMPLETED"];

export function GroupGameList({
  groupId,
  games,
  canEdit,
}: {
  groupId: string;
  games: GroupGameItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<GameStatus | "ALL">("ALL");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredGames = filter === "ALL" ? games : games.filter((g) => g.status === filter);

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/steam/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results ?? []);
      setSearched(true);
    } catch {
      setError("Steamの検索に失敗しました");
    } finally {
      setSearching(false);
    }
  }

  async function addGame(result: SteamResult) {
    setAddingId(result.appId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "追加に失敗しました");
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      setSearched(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setAddingId(null);
    }
  }

  async function changeStatus(gameId: string, status: GameStatus) {
    setUpdatingId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("ステータスの更新に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeGame(gameId: string) {
    setUpdatingId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("削除に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("ALL")}
            className={`rounded-sm border px-2 py-1 font-mono text-[10px] transition ${
              filter === "ALL"
                ? "border-steam-blue text-steam-blue"
                : "border-steam-border text-steam-muted hover:border-steam-blue"
            }`}
          >
            すべて
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] transition ${
                filter === s
                  ? STATUS_BADGE_CLASS[s]
                  : "border-steam-border text-steam-muted hover:border-steam-blue"
              }`}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {canEdit && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
          >
            <Plus size={14} /> ゲームを追加
          </button>
        )}
      </div>

      {filteredGames.length === 0 ? (
        <p className="mt-4 font-mono text-sm text-steam-muted">
          まだゲームが登録されていません。
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filteredGames.map((game) => (
            <div
              key={game.id}
              className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface transition hover:border-steam-blue"
            >
              <Link href={`/groups/${groupId}/games/${game.id}`}>
                <div className="relative h-24 w-full overflow-hidden bg-steam-panel">
                  {game.coverUrl ? (
                    <img src={game.coverUrl} alt={game.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-steam-muted/60">
                      No Image
                    </div>
                  )}
                </div>
                <div className="px-2 pt-2">
                  <p className="truncate font-display text-sm font-semibold text-steam-text">
                    {game.title}
                  </p>
                  <p className="truncate font-mono text-[9px] text-steam-muted/70">
                    {game.addedByName}が追加
                  </p>
                </div>
              </Link>
              <div className="p-2">
                <div className="flex items-center justify-between gap-1">
                  {canEdit ? (
                    <select
                      value={game.status}
                      disabled={updatingId === game.id}
                      onChange={(e) => changeStatus(game.id, e.target.value as GameStatus)}
                      className={`rounded-sm border bg-steam-panel px-1 py-0.5 font-mono text-[10px] outline-none disabled:opacity-50 ${STATUS_BADGE_CLASS[game.status]}`}
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${STATUS_BADGE_CLASS[game.status]}`}
                    >
                      {STATUS_LABEL[game.status]}
                    </span>
                  )}

                  {canEdit && (
                    <button
                      onClick={() => removeGame(game.id)}
                      disabled={updatingId === game.id}
                      className="flex-shrink-0 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
                      aria-label="削除"
                    >
                      {updatingId === game.id ? <Spinner size={12} /> : <Trash2 size={12} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">
                ゲームをリストに追加
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-steam-muted hover:text-steam-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ゲーム名で検索"
                disabled={searching}
                className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
              >
                {searching ? <Spinner size={12} /> : <Search size={12} />}
                検索
              </button>
            </div>

            <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.appId}
                  onClick={() => addGame(r)}
                  disabled={addingId !== null}
                  className="flex items-center gap-3 rounded-sm border border-steam-border bg-steam-panel p-2 text-left transition hover:border-steam-blue disabled:opacity-50"
                >
                  <img src={r.thumbnail} alt="" className="h-10 w-16 flex-shrink-0 rounded-sm object-cover" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">{r.name}</span>
                  {addingId === r.appId && <Spinner size={14} className="flex-shrink-0" />}
                </button>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="font-mono text-[11px] text-steam-muted/70">見つかりませんでした</p>
              )}
            </div>

            {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
