"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// アルバム作成画面：タイトル・説明・ゲームタグ（任意）を入力してPOST /api/albums
export default function NewAlbumPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("タイトルを入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
          gameTitle: gameTitle.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { album } = await res.json();
      router.push(`/albums/${album.id}`);
    } catch {
      setError("アルバムの作成に失敗しました");
      setPending(false);
    }
  }

  return (
    <main className="p-4 sm:p-6">
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-1 font-mono text-xs text-steam-muted"
      >
        <ChevronLeft size={14} /> 戻る
      </button>

      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        新しいアルバムを作成
      </h1>

      <div className="mt-6 flex max-w-md flex-col gap-4">
        <div>
          <label className="font-mono text-[11px] text-steam-muted">
            タイトル <span className="text-[#eb4b4b]">*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：エルデンリング"
            disabled={pending}
            className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        <div>
          <label className="font-mono text-[11px] text-steam-muted">説明（任意）</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="どんなアルバムか一言メモ"
            disabled={pending}
            className="mt-1 w-full resize-none rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        <div>
          <label className="font-mono text-[11px] text-steam-muted">ゲームタイトル（任意）</label>
          <input
            value={gameTitle}
            onChange={(e) => setGameTitle(e.target.value)}
            placeholder="例：Elden Ring"
            disabled={pending}
            className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
          <p className="mt-1 font-mono text-[10px] text-steam-muted/70">
            後からアルバム詳細画面でDiscordのハッシュタグと紐付けできます
          </p>
        </div>

        {error && <p className="font-mono text-xs text-[#eb4b4b]">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={pending || !title.trim()}
          className="rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {pending ? "作成中…" : "アルバムを作成"}
        </button>
      </div>
    </main>
  );
}
