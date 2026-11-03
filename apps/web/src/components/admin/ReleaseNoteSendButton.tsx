"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { primaryButton } from "@/components/ui/buttonStyles";

/**
 * パッチノートを、まだ送っていないグループへ送るボタン（/admin/release-notes）。
 * 送れたグループだけが「送信済み」になるので、失敗したグループはもう一度押せばそこだけ送り直せる
 */
export function ReleaseNoteSendButton({ version, pending }: { version: string; pending: number }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending) return;
    setSending(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/release-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "送信に失敗しました");
      const parts = [`${data.sent}件のグループへ送りました`];
      if (data.failed > 0) parts.push(`${data.failed}件は送れませんでした（もう一度押すと、そこだけ送り直します）`);
      setMessage(`${parts.join("。")}。`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <button onClick={send} disabled={sending || pending === 0} className={primaryButton}>
        {sending ? <Spinner size={16} /> : <Send size={16} aria-hidden="true" />}
        {pending === 0 ? "未送信のグループはありません" : `未送信の${pending}グループへ送る`}
      </button>
      {message && <p className="mt-2 text-sm text-steam-text">{message}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
