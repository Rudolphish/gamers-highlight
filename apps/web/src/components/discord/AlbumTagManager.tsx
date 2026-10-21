"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, X, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { fieldClass, ghostIconButton, secondaryButton } from "@/components/ui/buttonStyles";

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
    <div className="rounded-xl bg-steam-surface p-4">
      <h2 className="text-base font-bold text-steam-text">タグ（ハッシュタグ別名）</h2>
      <p className="mt-1 text-sm text-steam-muted">
        Discordでこのアルバムに投稿する際のハッシュタグを複数登録できます。
        「#eldenring」と「#elden_ring」のような表記ゆれをまとめたい場合、
        両方をここに追加してください。
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-1 rounded-full bg-steam-panel py-0.5 pl-3 text-sm text-steam-text"
          >
            <Hash size={14} className="text-steam-blue" aria-hidden="true" />
            {t.tag}
            <button
              onClick={() => removeTag(t.id)}
              disabled={pending}
              className={`${ghostIconButton} hover:text-danger`}
              aria-label={`${t.tag}を削除`}
            >
              {removingTagId === t.id ? <Spinner size={14} /> : <X size={14} aria-hidden="true" />}
            </button>
          </li>
        ))}
        {tags.length === 0 && (
          <span className="text-sm text-steam-muted">
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
          className={`${fieldClass} min-w-0 flex-1`}
          disabled={pending}
        />
        <button
          onClick={addTag}
          disabled={pending || !draft.trim()}
          className={secondaryButton}
        >
          {adding ? <Spinner size={16} /> : <Plus size={16} aria-hidden="true" />}
          {adding ? "追加中…" : "追加"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
