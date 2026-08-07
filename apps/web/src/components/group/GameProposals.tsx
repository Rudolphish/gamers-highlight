"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Search, ThumbsUp, HelpCircle, ThumbsDown, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type ReactionType = "LIKE" | "MAYBE" | "PASS";

type Proposal = {
  id: string;
  title: string;
  coverUrl: string | null;
  proposedById: string;
  proposedByName: string;
  reactions: { userId: string; type: ReactionType }[];
};

type SteamResult = { appId: number; name: string; thumbnail: string };

const REACTIONS: { type: ReactionType; icon: typeof ThumbsUp; label: string }[] = [
  { type: "LIKE", icon: ThumbsUp, label: "やりたい" },
  { type: "MAYBE", icon: HelpCircle, label: "気になる" },
  { type: "PASS", icon: ThumbsDown, label: "興味なし" },
];

// ゲーム提案機能：メンバーが提案→他メンバーがリアクション→LIKEが過半数に達すると
// 自動でグループのゲームリスト（WISHLIST）に昇格する（判定はサーバー側、reactions APIで実施）。
export function GameProposals({
  groupId,
  proposals,
  currentUserId,
  likeThreshold,
  canManage,
}: {
  groupId: string;
  proposals: Proposal[];
  currentUserId: string;
  likeThreshold: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [proposingId, setProposingId] = useState<number | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/steam/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results ?? []);
      setSearched(true);
    } catch {
      setError("Steamの検索に失敗しました");
    } finally {
      setSearching(false);
    }
  }

  async function propose(result: SteamResult) {
    setProposingId(result.appId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "提案に失敗しました");
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      setSearched(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提案に失敗しました");
    } finally {
      setProposingId(null);
    }
  }

  async function react(proposalId: string, type: ReactionType) {
    setReactingId(proposalId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("リアクションに失敗しました");
    } finally {
      setReactingId(null);
    }
  }

  async function withdraw(proposalId: string) {
    setWithdrawingId(proposalId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("取り下げに失敗しました");
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <div className="mt-4 border-t border-steam-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
          ゲーム提案
        </h3>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-sm border border-steam-border px-2 py-1 font-mono text-[10px] text-steam-text transition hover:border-steam-blue"
        >
          <Plus size={12} /> 提案する
        </button>
      </div>

      {proposals.length === 0 ? (
        <p className="mt-2 font-mono text-[10px] text-steam-muted/70">まだ提案はありません。</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {proposals.map((p) => {
            const likeCount = p.reactions.filter((r) => r.type === "LIKE").length;
            const myReaction = p.reactions.find((r) => r.userId === currentUserId)?.type;
            const canWithdraw = canManage || p.proposedById === currentUserId;

            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel p-2"
              >
                {p.coverUrl && (
                  <img src={p.coverUrl} alt={p.title} className="h-12 w-20 flex-shrink-0 rounded-sm object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-steam-text">{p.title}</p>
                  <p className="truncate font-mono text-[9px] text-steam-muted/70">
                    {p.proposedByName}が提案・やりたい {likeCount}/{likeThreshold}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    {REACTIONS.map(({ type, icon: Icon, label }) => {
                      const count = p.reactions.filter((r) => r.type === type).length;
                      const active = myReaction === type;
                      return (
                        <button
                          key={type}
                          onClick={() => react(p.id, type)}
                          disabled={reactingId !== null}
                          title={label}
                          className={`flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] transition disabled:opacity-50 ${
                            active
                              ? "border-steam-blue text-steam-blue"
                              : "border-steam-border text-steam-muted hover:border-steam-blue"
                          }`}
                        >
                          <Icon size={10} /> {count}
                        </button>
                      );
                    })}
                    {canWithdraw && (
                      <button
                        onClick={() => withdraw(p.id)}
                        disabled={withdrawingId === p.id}
                        title="取り下げる"
                        className="ml-auto flex-shrink-0 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
                      >
                        {withdrawingId === p.id ? <Spinner size={11} /> : <Trash2 size={11} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 font-mono text-[10px] text-[#eb4b4b]">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">ゲームを提案する</h2>
              <button onClick={() => setOpen(false)} className="text-steam-muted hover:text-steam-text">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ゲーム名で検索"
                disabled={searching}
                className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
              >
                {searching ? <Spinner size={12} /> : <Search size={12} />}
                検索
              </button>
            </div>

            <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.appId}
                  onClick={() => propose(r)}
                  disabled={proposingId !== null}
                  className="flex items-center gap-3 rounded-sm border border-steam-border bg-steam-panel p-2 text-left transition hover:border-steam-blue disabled:opacity-50"
                >
                  <img src={r.thumbnail} alt="" className="h-10 w-16 flex-shrink-0 rounded-sm object-cover" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">{r.name}</span>
                  {proposingId === r.appId && <Spinner size={14} className="flex-shrink-0" />}
                </button>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="font-mono text-[11px] text-steam-muted/70">見つかりませんでした</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
