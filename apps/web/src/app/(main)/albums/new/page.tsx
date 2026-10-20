"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

type GroupOption = { id: string; name: string };

// アルバム作成画面：所属グループ・タイトル・説明・ゲームタグ（任意）を入力してPOST /api/albums
export default function NewAlbumPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/groups")
      .then((res) => res.json())
      .then((data) => {
        setGroups(data.groups ?? []);
        if (data.groups?.length === 1) setGroupId(data.groups[0].id);
      });
  }, []);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("タイトルを入力してください");
      return;
    }
    if (!groupId) {
      setError("グループを選択してください");
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
          groupId,
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
        className="mb-4 flex items-center gap-1 text-xs text-steam-muted"
      >
        <ChevronLeft size={14} /> 戻る
      </button>

      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        新しいアルバムを作成
      </h1>

      <div className="mt-6 flex max-w-md flex-col gap-4">
        <div>
          <label className="text-2xs text-steam-muted">
            グループ <span className="text-danger">*</span>
          </label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          >
            <option value="">グループを選択</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

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
          disabled={pending || !title.trim() || !groupId}
          className="rounded-sm bg-accent py-2.5 text-sm font-bold text-accent-ink disabled:opacity-40"
        >
          {pending ? "作成中…" : "アルバムを作成"}
        </button>
      </div>
    </main>
  );
}
