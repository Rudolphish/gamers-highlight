"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Pencil, Check, X } from "lucide-react";

type ChannelOption = { id: string; name: string };

// ウィッシュリストの最安値更新通知（Discord）の投稿先チャンネルIDをオーナーが設定する。
// Botがそのサーバーに参加していれば、チャンネル一覧をプルダウンから選べる
// （/api/groups/:id/discord-channels経由）。取得できない場合（サーバーID未設定、
// Bot未参加等）はチャンネルIDの直接入力にフォールバックする。
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
  // undefined=読み込み中、null=取得不可（手打ちにフォールバック）
  const [channels, setChannels] = useState<ChannelOption[] | null | undefined>(undefined);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setDisplayChannelId(channelId), [channelId]);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setChannels(undefined);
    fetch(`/api/groups/${groupId}/discord-channels`)
      .then((res) => (res.ok ? res.json() : { channels: null }))
      .then((data) => {
        if (!cancelled) setChannels(data.channels ?? null);
      })
      .catch(() => {
        if (!cancelled) setChannels(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, groupId]);

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

  const useDropdown = Array.isArray(channels) && channels.length > 0;
  const knownIds = new Set((channels ?? []).map((c) => c.id));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {channels === undefined ? (
          <span className="font-mono text-[10px] text-steam-muted">チャンネル一覧を取得中…</span>
        ) : useDropdown ? (
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-mono text-[10px] text-steam-text outline-none focus:border-steam-blue"
          >
            <option value="">通知オフ</option>
            {draft && !knownIds.has(draft) && (
              <option value={draft}>#{draft}（現在の設定）</option>
            )}
            {channels!.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            placeholder="DiscordチャンネルID（空欄で通知オフ）"
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1 font-mono text-[10px] text-steam-text outline-none focus:border-steam-blue"
          />
        )}
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
      {channels === null && (
        <p className="font-mono text-[9px] text-steam-muted/60">
          チャンネル一覧を取得できませんでした（サーバーID未設定、またはBot未参加の可能性）。IDを直接入力してください。
        </p>
      )}
      {error && <p className="font-mono text-[9px] text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
