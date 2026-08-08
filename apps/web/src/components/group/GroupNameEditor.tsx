"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";

export function GroupNameEditor({
  groupId,
  name,
  canEdit,
}: {
  groupId: string;
  name: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setDisplayName(name), [name]);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayName) {
      setEditing(false);
      setDraft(displayName);
      return;
    }
    const previous = displayName;
    // 即座に確定表示に切り替え、失敗した時だけ元に戻す
    setDisplayName(trimmed);
    setEditing(false);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setDisplayName(previous);
      setError("グループ名の更新に失敗しました");
    }
  }

  if (!canEdit) {
    return <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">{displayName}</h1>;
  }

  if (!editing) {
    return (
      <div>
        <button
          onClick={() => {
            setDraft(displayName);
            setEditing(true);
          }}
          className="group flex items-center gap-2 font-display text-2xl font-bold text-steam-text sm:text-3xl"
        >
          {displayName}
          <Pencil size={16} className="text-steam-muted opacity-0 transition group-hover:opacity-100" />
        </button>
        {error && <p className="mt-1 font-mono text-[10px] text-[#eb4b4b]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-display text-2xl font-bold text-steam-text outline-none focus:border-steam-blue sm:text-3xl"
      />
      <button onClick={save} aria-label="保存" className="p-2 text-steam-blue">
        <Check size={18} />
      </button>
      <button
        onClick={() => {
          setEditing(false);
          setDraft(displayName);
        }}
        aria-label="キャンセル"
        className="p-2 text-steam-muted"
      >
        <X size={18} />
      </button>
    </div>
  );
}
