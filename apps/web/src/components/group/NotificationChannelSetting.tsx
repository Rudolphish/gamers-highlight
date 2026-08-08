"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Pencil, Check, X } from "lucide-react";

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
  const [displayChannelId, setDisplayChannelId] = useState(channelId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(channelId ?? "");
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setDisplayChannelId(channelId), [channelId]);

  async function save() {
    const trimmed = draft.trim();
    const previous = displayChannelId;
    // 即座に確定表示に切り替え、失敗した時だけ元に戻す
    setDisplayChannelId(trimmed || null);
    setEditing(false);
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
      router.refresh();
    } catch (e) {
      setDisplayChannelId(previous);
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  if (!editing) {
    return (
      <div>
        <button
          onClick={() => {
            setDraft(displayChannelId ?? "");
            setEditing(true);
          }}
          className="group flex items-center gap-1.5 font-mono text-[10px] text-steam-muted transition hover:text-steam-text"
        >
          <Bell size={11} />
          {displayChannelId ? `通知先チャンネル: ${displayChannelId}` : "最安値更新の通知先チャンネルを設定"}
          <Pencil size={10} className="opacity-0 transition group-hover:opacity-100" />
        </button>
        {error && <p className="mt-1 font-mono text-[9px] text-[#eb4b4b]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          placeholder="DiscordチャンネルID（空欄で通知オフ）"
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-mono text-[10px] text-steam-text outline-none focus:border-steam-blue"
        />
        <button onClick={save} aria-label="保存" className="text-steam-blue">
          <Check size={14} />
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(displayChannelId ?? "");
            setError(null);
          }}
          aria-label="キャンセル"
          className="text-steam-muted"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
