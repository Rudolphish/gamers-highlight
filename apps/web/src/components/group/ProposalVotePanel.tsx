"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export type ReactionType = "LIKE" | "MAYBE" | "PASS";

export type ProposalVoter = { userId: string; name: string; type: ReactionType };

const REACTIONS: { type: ReactionType; icon: typeof ThumbsUp; label: string }[] = [
  { type: "LIKE", icon: ThumbsUp, label: "やりたい" },
  { type: "MAYBE", icon: HelpCircle, label: "気になる" },
  { type: "PASS", icon: ThumbsDown, label: "興味なし" },
];

/**
 * 提案の詳細ページ用の投票UI。グループ詳細のカード（GameProposals）が
 * 件数だけのコンパクト表示なのに対し、こちらは誰がどう投票したかまで出す。
 *
 * 投票先のAPIは共通（POST /api/groups/:id/proposals/:proposalId/reactions）で、
 * 同じ種類をもう一度押すと取り消し、別の種類を押すと切り替わる。
 * LIKEが過半数に達するとサーバー側でゲームリストに昇格するため、
 * その場合はページを再取得してゲーム詳細への案内に切り替える。
 */
export function ProposalVotePanel({
  groupId,
  proposalId,
  voters,
  currentUserId,
  likeThreshold,
  canWithdraw,
}: {
  groupId: string;
  proposalId: string;
  voters: ProposalVoter[];
  currentUserId: string;
  likeThreshold: number;
  canWithdraw: boolean;
}) {
  const router = useRouter();
  const [localVoters, setLocalVoters] = useState(voters);
  const [pending, setPending] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setLocalVoters(voters), [voters]);

  const myReaction = localVoters.find((v) => v.userId === currentUserId)?.type ?? null;
  const likeCount = localVoters.filter((v) => v.type === "LIKE").length;

  async function react(type: ReactionType) {
    if (pending) return;
    const previous = localVoters;
    const others = previous.filter((v) => v.userId !== currentUserId);
    // 同じ種類をもう一度押した時はサーバー側で取り消しになるので、UIも外す
    setLocalVoters(
      myReaction === type ? others : [...others, { userId: currentUserId, name: "あなた", type }]
    );
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "投票に失敗しました");
      }
      // 昇格した場合もサーバー側の描画で採用済み表示に切り替わる
      router.refresh();
    } catch (e) {
      setLocalVoters(previous);
      setError(e instanceof Error ? e.message : "投票に失敗しました");
    } finally {
      setPending(false);
    }
  }

  async function withdraw() {
    if (withdrawing) return;
    setWithdrawing(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "取り下げに失敗しました");
      }
      router.push(`/groups/${groupId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り下げに失敗しました");
      setWithdrawing(false);
    }
  }

  return (
    <div className="rounded-sm border border-steam-border bg-steam-panel p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">投票</h2>
        <span className="font-mono text-3xs text-steam-muted">
          やりたい {likeCount}/{likeThreshold}
        </span>
      </div>

      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-steam-bg">
        <div
          className="h-full rounded-sm bg-gradient-to-r from-steam-blue/60 to-steam-blue transition-all"
          style={{ width: `${Math.min((likeCount / likeThreshold) * 100, 100)}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-4xs text-steam-muted/70">
        「やりたい」が{likeThreshold}人に達すると、自動でゲームリストに追加されます
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {REACTIONS.map(({ type, icon: Icon, label }) => {
          const votedBy = localVoters.filter((v) => v.type === type);
          const active = myReaction === type;
          return (
            <div key={type} className="flex items-start gap-2">
              <button
                onClick={() => react(type)}
                disabled={pending}
                aria-pressed={active}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-3xs transition disabled:opacity-50 ${
                  active
                    ? "border-steam-blue text-steam-blue"
                    : "border-steam-border text-steam-muted hover:border-steam-blue"
                }`}
              >
                <Icon size={12} /> {label} {votedBy.length}
              </button>
              {votedBy.length > 0 && (
                <p className="min-w-0 flex-1 pt-1.5 font-mono text-4xs text-steam-muted/70">
                  {votedBy.map((v) => v.name).join("、")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {canWithdraw && (
        <button
          onClick={withdraw}
          disabled={withdrawing}
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-3xs text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
        >
          {withdrawing ? <Spinner size={11} /> : <Trash2 size={11} />}
          この提案を取り下げる
        </button>
      )}

      {error && <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
