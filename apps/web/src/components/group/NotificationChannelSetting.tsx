"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Pencil, Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

// ウィッシュリストの最安値更新通知（Discord）の投稿先チャンネルIDをオーナーが設定する。
// チャンネルIDはDiscordの「開発者モード」を有効にしてチャンネルを右クリック→「IDをコピー」で取得する
// （グループ作成時のサーバーID取得と同じ手順）。
export function NotificationChannelSetting({
  groupId,
  channelId,
}: {
  groupId: string;
  channelId: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(channelId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = draft.trim();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationChannelId: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "更新に失敗しました");
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group flex items-center gap-1.5 font-mono text-[10px] text-steam-muted transition hover:text-steam-text"
      >
        <Bell size={11} />
        {channelId ? `通知先チャンネル: ${channelId}` : "最安値更新の通知先チャンネルを設定"}
        <Pencil size={10} className="opacity-0 transition group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          autoFocus
          placeholder="DiscordチャンネルID（空欄で通知オフ）"
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-mono text-[10px] text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        />
        <button onClick={save} disabled={pending} className="text-steam-blue disabled:opacity-50">
          {pending ? <Spinner size={14} /> : <Check size={14} />}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(channelId ?? "");
            setError(null);
          }}
          disabled={pending}
          className="text-steam-muted disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
      {error && <p className="font-mono text-[9px] text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
