"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { dangerButton } from "@/components/ui/buttonStyles";

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
      className={dangerButton}
    >
      {pending ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
      削除
    </button>
  );
}
