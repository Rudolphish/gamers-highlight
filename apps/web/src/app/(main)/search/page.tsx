"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search as SearchIcon, Gamepad2 } from "lucide-react";
import { PhotoGrid } from "@/components/photo/PhotoGrid";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  description?: string | null;
  descriptionEditorName?: string | null;
  descriptionUpdatedAt?: string | null;
};

type GroupGameResult = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  coverUrl: string | null;
  status?: "WISHLIST" | "PLAYING" | "BACKLOG" | "COMPLETED";
};

const STATUS_LABEL: Record<string, string> = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
};

export default function SearchPage() {
  const [game, setGame] = useState("");
  const [uploader, setUploader] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [photos, setPhotos] = useState<Media[]>([]);
  const [groupGames, setGroupGames] = useState<GroupGameResult[]>([]);
  const [groupProposals, setGroupProposals] = useState<GroupGameResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);

  async function fetchPhotos(params?: { game?: string; uploader?: string; from?: string; to?: string }) {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (params?.game?.trim()) query.set("game", params.game.trim());
      if (params?.uploader?.trim()) query.set("uploader", params.uploader.trim());
      if (params?.from) query.set("from", params.from);
      if (params?.to) query.set("to", params.to);

      const res = await fetch(`/api/photos/search?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPhotos(data.photos ?? []);
      } else {
        setPhotos([]);
      }

      // グループのゲームリスト/提案の検索は「ゲームタイトル」欄が入力されている時だけ行う
      const trimmedGame = params?.game?.trim();
      if (trimmedGame) {
        const groupRes = await fetch(`/api/search/group-games?q=${encodeURIComponent(trimmedGame)}`);
        if (groupRes.ok) {
          const data = await groupRes.json();
          setGroupGames(data.games ?? []);
          setGroupProposals(data.proposals ?? []);
        } else {
          setGroupGames([]);
          setGroupProposals([]);
        }
      } else {
        setGroupGames([]);
        setGroupProposals([]);
      }
    } catch {
      setPhotos([]);
      setGroupGames([]);
      setGroupProposals([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  useEffect(() => {
    fetchPhotos();
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchPhotos({ game, uploader, from, to });
  }

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        スクショを探す
      </h1>
      <p className="mt-1 font-mono text-xs text-steam-muted">
        ゲームタイトル、写真の説明、投稿者、日付で検索できます
      </p>

      <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-3 rounded-sm border border-steam-border bg-steam-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="font-mono text-2xs text-steam-muted">ゲームタイトル・説明</label>
            <input
              type="text"
              value={game}
              onChange={(e) => setGame(e.target.value)}
              placeholder="例: ELDEN RING"
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
          <div>
            <label className="font-mono text-2xs text-steam-muted">投稿者ID</label>
            <input
              type="text"
              value={uploader}
              onChange={(e) => setUploader(e.target.value)}
              placeholder="ユーザーID"
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="font-mono text-2xs text-steam-muted">開始日</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
          <div>
            <label className="font-mono text-2xs text-steam-muted">終了日</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex items-center justify-center gap-2 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-50 hover:brightness-110 transition"
        >
          <SearchIcon size={16} />
          {loading ? "検索中…" : "検索"}
        </button>
      </form>

      <section className="mt-6">
        <h2 className="font-mono text-xs text-steam-muted mb-3">
          {searched ? `検索結果 (${photos.length} 件)` : "読み込み中…"}
        </h2>

        {loading ? (
          <p className="font-mono text-xs text-steam-muted">読み込み中…</p>
        ) : photos.length > 0 ? (
          // 説明は表示だけ（canEditDescription を渡さないので編集ボタンは出ない）。
          // ここは複数アルバム横断で、1枚ずつEDITOR権限を判定する足場が無いため
          <PhotoGrid
            photos={photos.map((p) => ({
              ...p,
              description: {
                text: p.description ?? null,
                editorName: p.descriptionEditorName ?? null,
                updatedAt: p.descriptionUpdatedAt ?? null,
              },
            }))}
          />
        ) : (
          <div className="rounded-sm border border-dashed border-steam-border bg-steam-surface p-8 text-center font-mono text-xs text-steam-muted">
            該当するスクリーンショットが見つかりませんでした。
          </div>
        )}
      </section>

      {(groupGames.length > 0 || groupProposals.length > 0) && (
        <section className="mt-6">
          <h2 className="mb-3 font-mono text-xs text-steam-muted">
            グループのゲーム/提案 ({groupGames.length + groupProposals.length} 件)
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {groupGames.map((g) => (
              <Link
                key={`game-${g.id}`}
                href={`/groups/${g.groupId}/games/${g.id}`}
                className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface transition hover:border-steam-blue"
              >
                <div className="relative h-24 w-full overflow-hidden bg-steam-panel">
                  {g.coverUrl ? (
                    <Image
                      src={g.coverUrl}
                      alt={g.title}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-3xs text-steam-muted/60">
                      No Image
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate font-display text-sm font-semibold text-steam-text">{g.title}</p>
                  <p className="truncate font-mono text-4xs text-steam-muted/70">{g.groupName}</p>
                  {g.status && (
                    <span className="mt-1 inline-block rounded-sm border border-steam-border px-1.5 py-0.5 font-mono text-4xs text-steam-muted">
                      {STATUS_LABEL[g.status]}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {groupProposals.map((p) => (
              <Link
                key={`proposal-${p.id}`}
                href={`/groups/${p.groupId}`}
                className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface transition hover:border-steam-blue"
              >
                <div className="relative h-24 w-full overflow-hidden bg-steam-panel">
                  {p.coverUrl ? (
                    <Image
                      src={p.coverUrl}
                      alt={p.title}
                      fill
                      sizes="(max-width: 640px) 50vw, 25vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-mono text-3xs text-steam-muted/60">
                      No Image
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate font-display text-sm font-semibold text-steam-text">{p.title}</p>
                  <p className="truncate font-mono text-4xs text-steam-muted/70">{p.groupName}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-sm border border-steam-blue/50 px-1.5 py-0.5 font-mono text-4xs text-steam-blue">
                    <Gamepad2 size={9} /> 提案中
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

