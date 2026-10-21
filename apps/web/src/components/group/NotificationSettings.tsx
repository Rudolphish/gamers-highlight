"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { fieldClass } from "@/components/ui/buttonStyles";
import { NOTIFICATION_KINDS } from "@/lib/notificationTargets";

type ChannelOption = { id: string; name: string };
type Kind = (typeof NOTIFICATION_KINDS)[number]["kind"];

/**
 * グループの通知を、種類ごとにどのチャンネルへ送るか設定する（オーナーのみ）。
 *
 * **「送らない」は空欄で表す。** 種類ごとにオン/オフのスイッチを別に置くと、
 * 「オンなのに送り先が空」という矛盾した状態が作れてしまう。
 *
 * グループの設定画面（/groups/:id/settings）に、最初から開いた形で出す（2026-10 のデザイン刷新で
 * グループ画面の見出しの下から移した。以前は押して開く小さな行だった）。
 *
 * チャンネル一覧は表示したときに1回だけ取る（種類ごとに引かない）。
 * 取得できない場合（サーバーID未設定・Bot未参加など）はIDの直接入力に落とす。
 */
export function NotificationSettings({
  groupId,
  targets,
  legacyChannelId,
}: {
  groupId: string;
  targets: { kind: Kind; channelId: string }[];
  /** 種類ごとに分ける前の設定。引き継ぎが済んでいないことを知らせるためだけに使う */
  legacyChannelId: string | null;
}) {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelOption[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(targets.map((t) => [t.kind, t.channelId])),
  );
  // サーバーから最新が届いたら（router.refresh() 完了時など）正の値に置き換える
  useEffect(() => {
    setValues(Object.fromEntries(targets.map((t) => [t.kind, t.channelId])));
  }, [targets]);

  useEffect(() => {
    if (channels !== undefined) return;
    let cancelled = false;
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
  }, [channels, groupId]);

  async function save(kind: Kind, channelId: string) {
    const previous = values[kind] ?? "";
    setValues((v) => ({ ...v, [kind]: channelId }));
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, channelId }),
      });
      // 理由（別サーバーのチャンネル・一覧が取れない等）はAPIが文章で返すので、そのまま出す
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "更新に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setValues((v) => ({ ...v, [kind]: previous }));
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  }

  const configured = NOTIFICATION_KINDS.filter((k) => values[k.kind]).length;
  const useDropdown = Array.isArray(channels) && channels.length > 0;

  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold text-steam-text">
        <Bell size={18} aria-hidden="true" className="text-steam-muted" />
        Discordへの通知
        <span data-testid="notification-counter" className="text-sm font-normal text-steam-muted">
          {`（${configured}/${NOTIFICATION_KINDS.length} 種類がオン）`}
        </span>
      </h2>

      {/* **引き継ぎ漏れを黙って通さない。** 種類ごとに分ける前の設定が残っているのに
          1件も設定が無い場合、通知は全部止まっている。画面で気づけるようにする */}
      {legacyChannelId && configured === 0 && (
        <p className="mt-2 text-sm text-warning">
          {`以前の通知先（${legacyChannelId}）が引き継がれていません。通知は止まっています。下で種類ごとに選び直してください。`}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-4">
        {channels === undefined ? (
          <p className="text-sm text-steam-muted">チャンネル一覧を取得中…</p>
        ) : (
          NOTIFICATION_KINDS.map(({ kind, label, description }) => {
            const value = values[kind] ?? "";
            const knownIds = new Set((channels ?? []).map((c) => c.id));
            return (
              <div key={kind} className="flex flex-col gap-1.5">
                <label className="text-sm text-steam-text" htmlFor={`notify-${kind}`}>
                  {label}
                </label>
                {useDropdown ? (
                  <select
                    id={`notify-${kind}`}
                    value={value}
                    onChange={(e) => save(kind, e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">送らない</option>
                    {value && !knownIds.has(value) && (
                      <option value={value}>{`#${value}（現在の設定）`}</option>
                    )}
                    {channels!.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`#${c.name}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`notify-${kind}`}
                    defaultValue={value}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== value) save(kind, e.target.value.trim());
                    }}
                    placeholder="DiscordチャンネルID（空欄で送らない）"
                    className={fieldClass}
                  />
                )}
                <p className="text-xs text-steam-muted">{description}</p>
              </div>
            );
          })
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
