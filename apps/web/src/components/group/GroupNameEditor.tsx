"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditing(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!canEdit) {
    return <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">{name}</h1>;
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group flex items-center gap-2 font-display text-2xl font-bold text-steam-text sm:text-3xl"
      >
        {name}
        <Pencil size={16} className="text-steam-muted opacity-0 transition group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={pending}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-display text-2xl font-bold text-steam-text outline-none focus:border-steam-blue disabled:opacity-50 sm:text-3xl"
      />
      <button onClick={save} disabled={pending} className="text-steam-blue disabled:opacity-50">
        {pending ? <Spinner size={18} /> : <Check size={18} />}
      </button>
      <button
        onClick={() => {
          setEditing(false);
          setDraft(name);
        }}
        disabled={pending}
        className="text-steam-muted disabled:opacity-50"
      >
        <X size={18} />
      </button>
    </div>
  );
}
