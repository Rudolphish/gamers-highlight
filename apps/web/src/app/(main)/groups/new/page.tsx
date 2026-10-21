"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { primaryButton, textButton } from "@/components/ui/buttonStyles";

// グループ作成画面：名前を入力してPOST /api/groups
export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [guildId, setGuildId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("グループ名を入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, guildId: guildId.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "failed");
      }
      const { group } = await res.json();
      router.push(`/groups/${group.id}`);
    } catch (e) {
      setError(e instanceof Error && e.message !== "failed" ? e.message : "グループの作成に失敗しました");
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
        新しいグループを作成
      </h1>

      <div className="mt-6 flex max-w-md flex-col gap-4">
        <div>
          <label className="text-2xs text-steam-muted">
            グループ名 <span className="text-danger">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：ゲーム仲間"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        <div>
          <label className="text-2xs text-steam-muted">
            DiscordサーバーID（任意）
          </label>
          <input
            value={guildId}
            onChange={(e) => setGuildId(e.target.value)}
            placeholder="例：1534495271948521552"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
          <p className="mt-1 text-3xs text-steam-muted">
            指定すると、そのDiscordサーバーでのハッシュタグ投稿がこのグループに自動で取り込まれます。
            後から変更はできません。サーバーへのBot招待手順は
            <Link href="/manual#discord-bot-invite" className="text-steam-blue hover:underline">
              マニュアル
            </Link>
            を参照してください。
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={pending || !name.trim()}
          className={`${primaryButton}`}
        >
          {pending ? "作成中…" : "グループを作成"}
        </button>
      </div>
    </main>
  );
}
