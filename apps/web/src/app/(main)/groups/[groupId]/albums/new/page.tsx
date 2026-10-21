"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { primaryButton, textButton } from "@/components/ui/buttonStyles";

// グループ内アルバム作成画面：タイトル・説明・ゲームタグ（任意）を入力してPOST /api/albums
export default function NewGroupAlbumPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
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
          groupId: params.groupId,
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
        className={`${textButton} mb-2 -ml-2`}
      >
        <ChevronLeft size={16} aria-hidden="true" /> 戻る
      </button>

      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        新しいアルバムを作成
      </h1>

      <div className="mt-6 flex max-w-md flex-col gap-4">
        <div>
          <label className="text-2xs text-steam-muted">
            タイトル <span className="text-danger">*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：エルデンリング"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        <div>
          <label className="text-2xs text-steam-muted">説明（任意）</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="どんなアルバムか一言メモ"
            disabled={pending}
            className="mt-1 w-full resize-none rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        <div>
          <label className="text-2xs text-steam-muted">ゲームタイトル（任意）</label>
          <input
            value={gameTitle}
            onChange={(e) => setGameTitle(e.target.value)}
            placeholder="例：Elden Ring"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
          <p className="mt-1 text-3xs text-steam-muted">
            後からアルバム詳細画面でDiscordのハッシュタグと紐付けできます
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={pending || !title.trim()}
          className={`${primaryButton}`}
        >
          {pending ? "作成中…" : "アルバムを作成"}
        </button>
      </div>
    </main>
  );
}
