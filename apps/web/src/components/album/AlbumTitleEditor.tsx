"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { MAX_ALBUM_TITLE_LENGTH } from "@/lib/albumFields";

/**
 * アルバム名をその場で書き換える。
 *
 * **APIは前からアルバム名を変えられた**（`PATCH /api/albums/:id` の `title`）。
 * 画面にその入口が無かっただけで、マニュアルの権限表には
 * 「アルバム名や説明を編集する＝編集者」と書いてあった——**説明だけがあって
 * 実行する手段が無い**状態だったので、ここで入口を足す。
 *
 * 出すのは編集権限（オーナー／編集者）を持つ人だけ。閲覧者には見出しをそのまま出す。
 * サーバー側でも同じ判定をしているので、ここは見た目の出し分け専用。
 */
export function AlbumTitleEditor({ albumId, title }: { albumId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setValue(title);
    setError(null);
    setEditing(false);
  }

  async function save() {
    const next = value.trim();
    if (next.length === 0) {
      setError("アルバム名を入力してください");
      return;
    }
    // 変えていないなら投げない（往復も、更新順の並びも動かさない）
    if (next === title) {
      cancel();
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditing(false);
      router.refresh();
    } catch {
      setError("アルバム名の変更に失敗しました");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">{title}</h1>
        <button
          onClick={() => setEditing(true)}
          aria-label="アルバム名を変更"
          title="アルバム名を変更"
          className="rounded-sm border border-steam-border p-1.5 text-steam-muted hover:text-steam-text"
        >
          <Pencil size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          maxLength={MAX_ALBUM_TITLE_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          aria-label="アルバム名"
          className="w-full max-w-xs rounded-sm border border-steam-border bg-steam-bg px-2 py-1.5 font-display text-xl font-bold text-steam-text sm:text-2xl"
        />
        <button
          onClick={save}
          disabled={pending}
          aria-label="アルバム名を保存"
          className="rounded-sm border border-steam-border p-1.5 text-steam-blue hover:border-steam-blue disabled:opacity-50"
        >
          {pending ? <Spinner size={13} /> : <Check size={13} />}
        </button>
        <button
          onClick={cancel}
          disabled={pending}
          aria-label="変更をやめる"
          className="rounded-sm border border-steam-border p-1.5 text-steam-muted hover:text-steam-text disabled:opacity-50"
        >
          <X size={13} />
        </button>
      </div>
      {error && <p className="font-mono text-2xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
