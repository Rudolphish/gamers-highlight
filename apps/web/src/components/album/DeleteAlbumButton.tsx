"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function DeleteAlbumButton({ albumId, groupId }: { albumId: string; groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!window.confirm("このアルバムを削除しますか？中の写真/動画は未分類として残ります")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/albums/${albumId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.push(`/groups/${groupId}`);
      router.refresh();
    } catch {
      setPending(false);
      window.alert("アルバムの削除に失敗しました");
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={pending}
      className="flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-[#eb4b4b] hover:border-[#eb4b4b] disabled:opacity-50"
    >
      {pending ? <Spinner size={13} /> : <Trash2 size={13} />}
      削除
    </button>
  );
}
