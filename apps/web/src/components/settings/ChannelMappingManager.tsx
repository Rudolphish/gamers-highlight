"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type GroupOption = { id: string; name: string; guildId: string };
type Mapping = { id: string; guildId: string; channelId: string; gameTitle: string };

export function ChannelMappingManager({ groups }: { groups: GroupOption[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelId, setChannelId] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = groups.find((g) => g.id === groupId);

  useEffect(() => {
    setLoading(true);
    fetch("/api/discord/channel-mappings")
      .then((res) => res.json())
      .then((data) => setMappings(data.mappings ?? []))
      .finally(() => setLoading(false));
  }, []);

  const visibleMappings = mappings.filter((m) => m.guildId === selectedGroup?.guildId);

  async function addMapping() {
    if (!selectedGroup || !channelId.trim() || !gameTitle.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/discord/channel-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: selectedGroup.guildId,
          channelId: channelId.trim(),
          gameTitle: gameTitle.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { mapping } = await res.json();
      setMappings((prev) => [mapping, ...prev]);
      setChannelId("");
      setGameTitle("");
    } catch {
      setError("追加に失敗しました（同じチャンネルに既に別の設定がある可能性があります）");
    } finally {
      setAdding(false);
    }
  }

  async function removeMapping(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/discord/channel-mappings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError("削除に失敗しました");
    } finally {
      setRemovingId(null);
    }
  }

  if (groups.length === 0) {
    return (
      <p className="mt-6 font-mono text-sm text-steam-muted">
        Discordサーバーと紐付いたグループがありません。先に
        <a href="/groups/new" className="text-steam-blue hover:underline">
          グループを作成
        </a>
        してサーバーIDを設定してください。
      </p>
    );
  }

  return (
    <div className="mt-6 max-w-xl">
      <div>
        <label className="font-mono text-2xs text-steam-muted">対象グループ</label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 rounded-sm border border-steam-border bg-steam-surface p-4">
        <p className="font-mono text-2xs text-steam-muted">
          特定のチャンネルへの投稿を、ハッシュタグ無しでも自動的に指定のゲームに振り分けます
          （ハッシュタグが優先され、無い場合のフォールバックとして使われます）。
        </p>

        {loading ? (
          <p className="mt-3 font-mono text-xs text-steam-muted">読み込み中…</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visibleMappings.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">
                  チャンネル {m.channelId} → {m.gameTitle}
                </span>
                <button
                  onClick={() => removeMapping(m.id)}
                  disabled={removingId !== null}
                  className="flex-shrink-0 p-1.5 text-steam-muted hover:text-[#eb4b4b] disabled:opacity-50"
                  aria-label="削除"
                >
                  {removingId === m.id ? <Spinner size={13} /> : <Trash2 size={13} />}
                </button>
              </li>
            ))}
            {visibleMappings.length === 0 && (
              <li className="font-mono text-2xs text-steam-muted/60">まだ設定がありません</li>
            )}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-steam-border pt-4 sm:flex-row">
          <input
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="チャンネルID"
            disabled={adding}
            className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
          <input
            value={gameTitle}
            onChange={(e) => setGameTitle(e.target.value)}
            placeholder="ゲーム名"
            disabled={adding}
            className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
          />
          <button
            onClick={addMapping}
            disabled={adding || !channelId.trim() || !gameTitle.trim()}
            className="flex flex-shrink-0 items-center justify-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
          >
            {adding ? <Spinner size={12} /> : <Plus size={12} />}
            追加
          </button>
        </div>
        <p className="mt-2 font-mono text-3xs text-steam-muted/70">
          チャンネルIDはDiscordの開発者モードを有効にし、チャンネルを右クリック→「IDをコピー」で取得できます。
        </p>

        {error && <p className="mt-2 font-mono text-xs text-[#eb4b4b]">{error}</p>}
      </div>
    </div>
  );
}
