"use client";

import { useState } from "react";
import Link from "next/link";
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

/** **groupId を必ず持つ。** アルバムは名前だけで選ばせない（別グループの同名を取り違えるため） */
type AlbumOption = { id: string; title: string; groupId: string };
type GroupOption = { id: string; name: string };

export function UnclassifiedPhotoManager({
  photos,
  albums,
  groups,
}: {
  photos: Media[];
  albums: AlbumOption[];
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetAlbumId, setTargetAlbumId] = useState("");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  // **グループの選択は1つにまとめてある。** 「既存アルバムへ移す」も「新しく作る」も
  // 同じグループが相手なので、別々に選ばせると取り違えを起こしやすい。
  // 1つしか入っていない人には自動で選ぶ（毎回選ばせても手数が増えるだけ）
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0].id : "");
  const [action, setAction] = useState<"move" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = action !== null;

  /** 選んだグループのアルバムだけ。グループ未選択なら空 */
  const albumsInGroup = albums.filter((a) => a.groupId === groupId);

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
    if (selected.size === 0 || !title || !groupId) return;
    setAction("create");
    setError(null);
    try {
      const createRes = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, groupId }),
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
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-1 py-0.5 font-mono text-4xs font-bold text-white">
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

      {/* **先にグループを選ばせる。** 全グループのアルバムを名前だけで並べると、
          別グループの同名アルバムに入れてしまう（実際に報告があった）。
          この選択は下の「既存アルバムへ追加」と「新規作成」の両方に効く */}
      <div className="mt-6 rounded-sm border border-steam-border bg-steam-surface p-4">
        <label className="font-mono text-2xs text-steam-muted">グループ</label>
        <select
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value);
            setTargetAlbumId(""); // 別グループのアルバムが選ばれたまま残らないように戻す
          }}
          disabled={pending || groups.length === 0}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50 sm:max-w-xs"
        >
          <option value="">グループを選択</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {/* グループが無い／新しく作りたい人の逃げ道。ここで手が止まると、
            アルバムを選べない理由も次にどうすればよいかも分からない */}
        <p className="mt-1 font-mono text-4xs text-steam-muted/70">
          {groups.length === 0 ? "参加しているグループがありません。" : "入れたいグループが無いときは "}
          <Link href="/groups/new" className="text-steam-blue hover:underline">
            新しいグループを作る
          </Link>
          {groups.length === 0 ? "と、ここから振り分けられるようになります。" : "。"}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-4 rounded-sm border border-steam-border bg-steam-surface p-4 sm:flex-row sm:items-end sm:gap-6">
        <div className="flex-1">
          <label className="font-mono text-2xs text-steam-muted">既存アルバムに追加</label>
          <div className="mt-1 flex gap-2">
            <select
              value={targetAlbumId}
              onChange={(e) => setTargetAlbumId(e.target.value)}
              disabled={pending || !groupId}
              className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
            >
              <option value="">
                {!groupId
                  ? "先にグループを選んでください"
                  : albumsInGroup.length === 0
                    ? "このグループにはまだアルバムがありません"
                    : "アルバムを選択"}
              </option>
              {albumsInGroup.map((a) => (
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
          <label className="font-mono text-2xs text-steam-muted">
            新規アルバムを作って移動{groupId ? "（上で選んだグループに作ります）" : ""}
          </label>
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
              disabled={pending || selected.size === 0 || !newAlbumTitle.trim() || !groupId}
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
