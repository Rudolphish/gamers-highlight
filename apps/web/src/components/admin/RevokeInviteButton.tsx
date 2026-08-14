"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * 管理者としての招待リンク取り消し。
 *
 * 「まだ加入していないが、リンクを踏んでログイン済み」の人が居る場合、
 * その人のログイン権限も一緒に取り消される。数が変わるので確認を挟む。
 */
export function RevokeInviteButton({
  inviteId,
  groupName,
  pendingAccess,
}: {
  inviteId: string;
  groupName: string;
  pendingAccess: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    const warning =
      pendingAccess > 0
        ? `\n\nこのリンクでログイン済みの${pendingAccess}人は、まだグループに加入していません。取り消すとこの${pendingAccess}人はアプリにログインできなくなります。`
        : "";
    if (!confirm(`「${groupName}」の招待リンクを取り消します。${warning}`)) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "取り消しに失敗しました");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={revoke}
        disabled={pending}
        title="このリンクを取り消す"
        aria-label="このリンクを取り消す"
        className="p-1.5 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
      >
        {pending ? <Spinner size={11} /> : <Trash2 size={11} />}
      </button>
      {error && <span className="font-mono text-4xs text-[#eb4b4b]">{error}</span>}
    </span>
  );
}
