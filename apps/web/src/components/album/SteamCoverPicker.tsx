"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Gamepad2, X, Search, ListPlus, Check } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type SteamResult = { appId: number; name: string; thumbnail: string };

export function SteamCoverPicker({
  albumId,
  groupId,
  initialQuery,
  hasSteamCover,
  linkedGameId,
}: {
  albumId: string;
  groupId: string;
  initialQuery: string;
  hasSteamCover: boolean;
  linkedGameId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

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

  async function applyCover(appId: number) {
    setApplyingId(appId);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamAppId: appId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      router.refresh();
    } catch {
      setError("画像の設定に失敗しました");
    } finally {
      setApplyingId(null);
    }
  }

  async function addToGroupList(appId: number, name: string) {
    setAddingId(appId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: appId,
          title: name,
          coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
          albumId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("グループのゲームリストへの追加に失敗しました");
    } finally {
      setAddingId(null);
    }
  }

  async function clearCover() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamAppId: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      router.refresh();
    } catch {
      setError("解除に失敗しました");
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text hover:border-steam-blue"
      >
        <Gamepad2 size={13} /> Steam連携
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">
                Steamの画像をサムネイルに設定
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="p-2 text-steam-muted hover:text-steam-text"
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
                <div
                  key={r.appId}
                  className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel p-2"
                >
                  <Image
                    src={r.thumbnail}
                    alt=""
                    width={64}
                    height={40}
                    className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">{r.name}</span>
                  <button
                    onClick={() => applyCover(r.appId)}
                    disabled={applyingId !== null}
                    title="サムネイルに設定"
                    aria-label="サムネイルに設定"
                    className="flex-shrink-0 rounded-sm border border-steam-border p-2 text-steam-muted transition hover:border-steam-blue hover:text-steam-text disabled:opacity-50"
                  >
                    {applyingId === r.appId ? <Spinner size={13} /> : <Gamepad2 size={13} />}
                  </button>
                  <button
                    onClick={() => addToGroupList(r.appId, r.name)}
                    disabled={addingId !== null}
                    title="グループのゲームリストに追加"
                    aria-label="グループのゲームリストに追加"
                    className="flex-shrink-0 rounded-sm border border-steam-border p-2 text-steam-muted transition hover:border-steam-blue hover:text-steam-text disabled:opacity-50"
                  >
                    {addingId === r.appId ? (
                      <Spinner size={13} />
                    ) : linkedGameId ? (
                      <Check size={13} />
                    ) : (
                      <ListPlus size={13} />
                    )}
                  </button>
                </div>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="font-mono text-[11px] text-steam-muted/70">見つかりませんでした</p>
              )}
            </div>

            {linkedGameId && (
              <p className="mt-2 flex items-center gap-1 font-mono text-[10px] text-[#a4d007]">
                <Check size={11} /> このアルバムはグループのゲームリストと連携済みです
              </p>
            )}

            {hasSteamCover && (
              <button
                onClick={clearCover}
                disabled={clearing}
                className="mt-3 flex items-center gap-1 font-mono text-[11px] text-[#eb4b4b] disabled:opacity-50"
              >
                {clearing && <Spinner size={11} />}
                Steam画像を解除して投稿写真に戻す
              </button>
            )}

            {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
