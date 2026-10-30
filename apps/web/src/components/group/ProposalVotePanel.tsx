"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Meh, Minus, ThumbsUp, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { PROPOSAL_REACTION_LABELS } from "@/lib/gameLabels";
import { chipButton, textButton } from "@/components/ui/buttonStyles";

export type ReactionType = "LIKE" | "MAYBE" | "PASS";

export type ProposalVoter = { userId: string; name: string; type: ReactionType };

const REACTIONS: { type: ReactionType; icon: typeof ThumbsUp; label: string }[] = [
  { type: "LIKE", icon: ThumbsUp, label: PROPOSAL_REACTION_LABELS.LIKE },
  { type: "MAYBE", icon: Meh, label: PROPOSAL_REACTION_LABELS.MAYBE },
  { type: "PASS", icon: Minus, label: PROPOSAL_REACTION_LABELS.PASS },
];

/**
 * 提案の詳細ページ用の投票UI。グループ詳細のカード（GameProposals）が
 * 件数だけのコンパクト表示なのに対し、こちらは誰がどう投票したかまで出す。
 *
 * 投票先のAPIは共通（POST /api/groups/:id/proposals/:proposalId/reactions）で、
 * 同じ種類をもう一度押すと取り消し、別の種類を押すと切り替わる。
 * 全員が「やりたい」になるとサーバー側で「みんなでやりたい」に上がるので、
 * ページを再取得して「買った」の欄を出す（lib/proposalPromotion.ts）。
 */
export function ProposalVotePanel({
  groupId,
  proposalId,
  voters,
  currentUserId,
  likeThreshold,
  agreed,
  canWithdraw,
}: {
  groupId: string;
  proposalId: string;
  voters: ProposalVoter[];
  currentUserId: string;
  /** グループの全員の人数 */
  likeThreshold: number;
  /** 「みんなでやりたい」に上がっている */
  agreed: boolean;
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
      // 「みんなでやりたい」に上がった・戻った場合も、サーバー側の描画で切り替わる
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
    <div className="rounded-xl bg-steam-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold text-steam-text">投票</h2>
        <span className="font-num text-sm text-steam-muted">
          やりたい {likeCount}/{likeThreshold}
        </span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-steam-bg">
        <div
          className="h-full rounded-full bg-steam-blue transition-all"
          style={{ width: `${Math.min((likeCount / likeThreshold) * 100, 100)}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-steam-muted">
        {agreed
          ? "全員が「やりたい」を押したので「みんなでやりたい」に上がっています。誰かが外すとウィッシュリストに戻ります"
          : `全員（${likeThreshold}人）が「やりたい」を押すと「みんなでやりたい」に上がります`}
      </p>

      {/* リアクションはグループ画面のカードと同じ札を横に並べ、誰が押したかはその下にまとめる
          （以前は札を縦に1つずつ並べ、横に名前を出していた） */}
      <div className="mt-3 flex flex-wrap gap-2">
        {REACTIONS.map(({ type, icon: Icon, label }) => {
          const count = localVoters.filter((v) => v.type === type).length;
          return (
            <button
              key={type}
              onClick={() => react(type)}
              disabled={pending}
              aria-pressed={myReaction === type}
              className={chipButton(myReaction === type)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{`${label} ${count}`}</span>
            </button>
          );
        })}
      </div>
      {localVoters.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-steam-muted">
          {REACTIONS.map(({ type, label }) => {
            const names = localVoters.filter((v) => v.type === type).map((v) => v.name);
            return names.length > 0 ? <li key={type}>{`${label}：${names.join("、")}`}</li> : null;
          })}
        </ul>
      )}

      {canWithdraw && (
        <button
          onClick={withdraw}
          disabled={withdrawing}
          className={`${textButton} mt-2 -ml-2 hover:text-danger`}
        >
          {withdrawing ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
          この提案を取り下げる
        </button>
      )}

      {error && <p className="mt-2 text-3xs text-danger">{error}</p>}
    </div>
  );
}
