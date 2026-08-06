"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// グループ作成画面：名前を入力してPOST /api/groups
export default function NewGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { group } = await res.json();
      router.push(`/groups/${group.id}`);
    } catch {
      setError("グループの作成に失敗しました");
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
        新しいグループを作成
      </h1>

      <div className="mt-6 flex max-w-md flex-col gap-4">
        <div>
          <label className="font-mono text-[11px] text-steam-muted">
            グループ名 <span className="text-[#eb4b4b]">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：ゲーム仲間"
            disabled={pending}
            className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
        </div>

        {error && <p className="font-mono text-xs text-[#eb4b4b]">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={pending || !name.trim()}
          className="rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {pending ? "作成中…" : "グループを作成"}
        </button>
      </div>
    </main>
  );
}
