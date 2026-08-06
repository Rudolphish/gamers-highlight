"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, X, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

// アルバムに紐付くハッシュタグ（別名）の一覧・追加・削除UI。
// 「#eldenring」「#elden_ring」のような表記ゆれを、同じアルバムに複数タグとして
// 登録することで統合できるようにする（タグ検知の精度を上げるための機能）。
//
// 既に別のアルバムに紐付いているタグを追加すると、このアルバムへ付け替わる
// （＝表記ゆれの統合操作そのものになる。詳細は /api/albums/:id/tags のコメント参照）。

type GameTag = { id: string; tag: string; guildId: string };

type AlbumTagManagerProps = {
  albumId: string;
  initialTags: GameTag[];
};

// 現状1サーバー運用前提のため固定値。複数サーバー対応時はセレクトに変更する。
const DEFAULT_GUILD_ID = "default";

export function AlbumTagManager({ albumId, initialTags }: AlbumTagManagerProps) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = adding || removingTagId !== null;

  async function addTag() {
    const tag = draft.trim().toLowerCase();
    if (!tag) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, guildId: DEFAULT_GUILD_ID }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { tag: created } = await res.json();
      setTags((prev) => [...prev.filter((t) => t.tag !== tag), created]);
      setDraft("");
      router.refresh(); // 他アルバムから付け替わった場合など、画面全体の整合性を取る
    } catch {
      setError("タグの追加に失敗しました");
    } finally {
      setAdding(false);
    }
  }

  async function removeTag(tagId: string) {
    setRemovingTagId(tagId);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/tags/${tagId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    } catch {
      setError("タグの削除に失敗しました");
    } finally {
      setRemovingTagId(null);
    }
  }

  return (
    <div className="rounded-sm border border-steam-border bg-steam-surface p-4">
      <h2 className="font-display font-semibold text-steam-text">タグ（ハッシュタグ別名）</h2>
      <p className="mt-1 font-mono text-[11px] text-steam-muted">
        Discordでこのアルバムに投稿する際のハッシュタグを複数登録できます。
        「#eldenring」と「#elden_ring」のような表記ゆれをまとめたい場合、
        両方をここに追加してください。
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-1 rounded-sm border border-steam-border bg-steam-panel px-2 py-1 font-mono text-[11px] text-steam-muted"
          >
            <Hash size={10} className="text-steam-blue" />
            {t.tag}
            <button
              onClick={() => removeTag(t.id)}
              disabled={pending}
              className="ml-1 text-steam-muted hover:text-[#eb4b4b] disabled:opacity-50"
              aria-label={`${t.tag}を削除`}
            >
              {removingTagId === t.id ? <Spinner size={10} /> : <X size={10} />}
            </button>
          </li>
        ))}
        {tags.length === 0 && (
          <span className="font-mono text-[11px] text-steam-muted/60">
            タグ未設定（このアルバムは未分類扱いになります）
          </span>
        )}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          placeholder="er_clip"
          className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-1.5 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
          disabled={pending}
        />
        <button
          onClick={addTag}
          disabled={pending || !draft.trim()}
          className="flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-1.5 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {adding ? <Spinner size={12} /> : <Plus size={12} />}
          {adding ? "追加中…" : "追加"}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
