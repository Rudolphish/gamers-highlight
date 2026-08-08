"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, X, Search, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { translateGenre } from "@/lib/steam";

type GameStatus = "WISHLIST" | "PLAYING" | "BACKLOG" | "COMPLETED";

type GroupGameItem = {
  id: string;
  steamAppId: number;
  title: string;
  coverUrl: string | null;
  status: GameStatus;
  genres: string[];
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
  const [items, setItems] = useState(games);
  const [filter, setFilter] = useState<GameStatus | "ALL">("ALL");
  const [genreFilter, setGenreFilter] = useState<string | "ALL">("ALL");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setItems(games), [games]);

  const allGenres = Array.from(new Set(items.flatMap((g) => g.genres))).sort();

  const filteredGames = items.filter(
    (g) =>
      (filter === "ALL" || g.status === filter) &&
      (genreFilter === "ALL" || g.genres.includes(genreFilter))
  );

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
    const previous = items;
    const tempItem: GroupGameItem = {
      id: `temp-${result.appId}`,
      steamAppId: result.appId,
      title: result.name,
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
      status: "WISHLIST",
      genres: [],
      addedByName: "追加中…",
    };
    // 追加は即座に画面に反映し、モーダルも閉じてしまう（往復を待たせない）
    setItems([tempItem, ...previous]);
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: tempItem.coverUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "追加に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setItems(previous);
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    }
  }

  async function changeStatus(gameId: string, status: GameStatus) {
    const previous = items;
    setItems(items.map((g) => (g.id === gameId ? { ...g, status } : g)));
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
      setItems(previous);
      setError("ステータスの更新に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeGame(gameId: string) {
    const previous = items;
    setItems(items.filter((g) => g.id !== gameId));
    setUpdatingId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setItems(previous);
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

      {allGenres.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGenreFilter("ALL")}
            className={`rounded-sm border px-2 py-1 font-mono text-[10px] transition ${
              genreFilter === "ALL"
                ? "border-steam-blue text-steam-blue"
                : "border-steam-border text-steam-muted hover:border-steam-blue"
            }`}
          >
            全ジャンル
          </button>
          {allGenres.map((g) => (
            <button
              key={g}
              onClick={() => setGenreFilter(g)}
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] transition ${
                genreFilter === g
                  ? "border-steam-blue text-steam-blue"
                  : "border-steam-border text-steam-muted hover:border-steam-blue"
              }`}
            >
              {translateGenre(g)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 font-mono text-xs text-[#eb4b4b]">{error}</p>}

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
                    <Image
                      src={game.coverUrl}
                      alt={game.title}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                      className="object-cover"
                    />
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
                  {game.genres.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {game.genres.slice(0, 2).map((g) => (
                        <span
                          key={g}
                          className="rounded-sm bg-steam-panel px-1 py-0.5 font-mono text-[8px] text-steam-muted"
                        >
                          {translateGenre(g)}
                        </span>
                      ))}
                    </div>
                  )}
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
                aria-label="閉じる"
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
                  className="flex items-center gap-3 rounded-sm border border-steam-border bg-steam-panel p-2 text-left transition hover:border-steam-blue"
                >
                  <Image
                    src={r.thumbnail}
                    alt=""
                    width={64}
                    height={40}
                    className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">{r.name}</span>
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
