"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!window.confirm("このグループを削除しますか？元に戻せません")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error === "group has albums") {
          window.alert(
            `配下に${body.albumCount}件のアルバムが残っているため削除できません。先にアルバムを削除するか、別のグループへ移してください`
          );
        } else {
          window.alert("グループの削除に失敗しました");
        }
        setPending(false);
        return;
      }
      router.push("/groups");
      router.refresh();
    } catch {
      setPending(false);
      window.alert("グループの削除に失敗しました");
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
