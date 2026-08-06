"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Check, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingImage } from "@/components/ui/LoadingImage";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

type AlbumOption = { id: string; title: string };

export function UnclassifiedPhotoManager({
  photos,
  albums,
}: {
  photos: Media[];
  albums: AlbumOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetAlbumId, setTargetAlbumId] = useState("");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [action, setAction] = useState<"move" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = action !== null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(photos.map((p) => p.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function moveToExistingAlbum() {
    if (selected.size === 0 || !targetAlbumId) return;
    setAction("move");
    setError(null);
    try {
      const res = await fetch("/api/photos/assign-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected), albumId: targetAlbumId }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearSelection();
      setTargetAlbumId("");
      router.refresh();
    } catch {
      setError("移動に失敗しました");
    } finally {
      setAction(null);
    }
  }

  async function createAlbumAndMove() {
    const title = newAlbumTitle.trim();
    if (selected.size === 0 || !title) return;
    setAction("create");
    setError(null);
    try {
      const createRes = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const { album } = await createRes.json();

      const assignRes = await fetch("/api/photos/assign-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected), albumId: album.id }),
      });
      if (!assignRes.ok) throw new Error(await assignRes.text());

      clearSelection();
      setNewAlbumTitle("");
      router.push(`/albums/${album.id}`);
    } catch {
      setError("新規アルバム作成 or 移動に失敗しました");
    } finally {
      setAction(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-steam-muted">
        <span>{selected.size}件選択中</span>
        <button onClick={selectAll} className="text-steam-blue" disabled={pending}>
          全選択
        </button>
        <button onClick={clearSelection} className="text-steam-muted" disabled={pending}>
          選択解除
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {photos.map((item) => {
          const isSelected = selected.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              disabled={pending}
              className={`relative aspect-square overflow-hidden rounded-sm border ${
                isSelected ? "border-steam-blue" : "border-steam-border"
              }`}
            >
              {item.mediaType === "VIDEO" && !item.thumbnailUrl ? (
                <video
                  src={item.mediaUrl}
                  preload="metadata"
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <LoadingImage
                  src={item.thumbnailUrl ?? item.mediaUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              {item.mediaType === "VIDEO" && (
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-1 py-0.5 font-mono text-[9px] font-bold text-white">
                  <Play size={8} fill="white" /> {item.durationSeconds ?? "?"}s
                </span>
              )}
              <div
                className={`absolute inset-0 transition ${
                  isSelected ? "bg-steam-blue/25" : "bg-transparent"
                }`}
              />
              {isSelected && (
                <div className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-steam-blue text-[#0e1b12]">
                  <Check size={12} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-sm border border-steam-border bg-steam-surface p-4 sm:flex-row sm:items-end sm:gap-6">
        <div className="flex-1">
          <label className="font-mono text-[11px] text-steam-muted">既存アルバムに追加</label>
          <div className="mt-1 flex gap-2">
            <select
              value={targetAlbumId}
              onChange={(e) => setTargetAlbumId(e.target.value)}
              disabled={pending}
              className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
            >
              <option value="">アルバムを選択</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button
              onClick={moveToExistingAlbum}
              disabled={pending || selected.size === 0 || !targetAlbumId}
              className="flex flex-shrink-0 items-center justify-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
            >
              {action === "move" && <Spinner size={12} />}
              {action === "move" ? "追加中…" : "追加"}
            </button>
          </div>
        </div>

        <div className="flex-1">
          <label className="font-mono text-[11px] text-steam-muted">新規アルバムを作って移動</label>
          <div className="mt-1 flex gap-2">
            <input
              value={newAlbumTitle}
              onChange={(e) => setNewAlbumTitle(e.target.value)}
              placeholder="新しいアルバム名"
              disabled={pending}
              className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
            />
            <button
              onClick={createAlbumAndMove}
              disabled={pending || selected.size === 0 || !newAlbumTitle.trim()}
              className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
            >
              {action === "create" ? <Spinner size={12} /> : <Plus size={12} />}
              {action === "create" ? "作成中…" : "作成"}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
