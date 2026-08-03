"use client";

import { useState, useEffect } from "react";
import { Search as SearchIcon } from "lucide-react";
import { PhotoGrid } from "@/components/photo/PhotoGrid";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

export default function SearchPage() {
  const [game, setGame] = useState("");
  const [uploader, setUploader] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [photos, setPhotos] = useState<Media[]>([]);
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
    } catch {
      setPhotos([]);
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
    console.log("検索条件:", { game, uploader, from, to });
    fetchPhotos({ game, uploader, from, to });
  }

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        スクショを探す
      </h1>
      <p className="mt-1 font-mono text-xs text-steam-muted">
        ゲームタイトル、投稿者、日付で検索できます
      </p>

      <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-3 rounded-sm border border-steam-border bg-steam-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="font-mono text-[11px] text-steam-muted">ゲームタイトル</label>
            <input
              type="text"
              value={game}
              onChange={(e) => setGame(e.target.value)}
              placeholder="例: ELDEN RING"
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
          <div>
            <label className="font-mono text-[11px] text-steam-muted">投稿者ID</label>
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
            <label className="font-mono text-[11px] text-steam-muted">開始日</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
          <div>
            <label className="font-mono text-[11px] text-steam-muted">終了日</label>
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
          <PhotoGrid photos={photos} />
        ) : (
          <div className="rounded-sm border border-dashed border-steam-border bg-steam-surface p-8 text-center font-mono text-xs text-steam-muted">
            該当するスクリーンショットが見つかりませんでした。
          </div>
        )}
      </section>
    </main>
  );
}

