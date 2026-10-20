"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export type UnknownPlayItem = {
  gameKey: string;
  activityName: string;
  sessionCount: number;
};

type GameOption = { id: string; title: string };

// ゲームが分からなかったプレイ記録（Discordの表示名がゲームリストと一致しなかったもの）に、
// グループのゲームを選んで結びつける。対応付けの3段目（docs/play-log.md §2）。
//
// 選んだ結果はDiscordのアプリIDとSteamのゲームの対応として保存されるので、
// **同じゲームは次から自動で当たる。** 選ぶのはグループのメンバーなら誰でもよい。
export function UnknownPlays({
  groupId,
  plays,
  games,
}: {
  groupId: string;
  plays: UnknownPlayItem[];
  games: GameOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function assign(gameKey: string) {
    const groupGameId = selected[gameKey];
    if (!groupGameId || pendingKey) return;
    setPendingKey(gameKey);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/play-log/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameKey, groupGameId }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("結びつけに失敗しました");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div
      className="mb-4 rounded-sm border border-steam-border bg-steam-panel p-3"
      data-testid="unknown-plays"
    >
      <p className="flex items-center gap-1.5 font-mono text-xs font-bold text-steam-text">
        <HelpCircle size={13} /> ゲームが分からないプレイ
      </p>
      <p className="mt-1 font-mono text-3xs text-steam-muted">
        Discordに出ていた名前がゲームリストと一致しませんでした。どのゲームか選ぶと、
        過去の記録にも反映され、次からは自動で当たります。
        リストに無いゲームなら、先にゲームを追加してください。
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {plays.map((p) => (
          <li key={p.gameKey} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-steam-text">
              {p.activityName}
              <span className="ml-1 text-steam-muted">（{p.sessionCount}回）</span>
            </span>
            <select
              aria-label={`${p.activityName}のゲームを選ぶ`}
              value={selected[p.gameKey] ?? ""}
              onChange={(e) => setSelected((s) => ({ ...s, [p.gameKey]: e.target.value }))}
              className="min-h-[44px] rounded-sm border border-steam-border bg-steam-surface px-2 font-mono text-xs text-steam-text"
            >
              <option value="">ゲームを選ぶ</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => assign(p.gameKey)}
              disabled={!selected[p.gameKey] || pendingKey !== null}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm bg-steam-blue/20 px-3 font-mono text-xs text-steam-text disabled:opacity-50"
            >
              {pendingKey === p.gameKey && <Spinner size={12} />}
              結びつける
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 font-mono text-3xs text-danger">{error}</p>}
    </div>
  );
}
