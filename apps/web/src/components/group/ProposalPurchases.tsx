"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ShoppingCart } from "lucide-react";
import { chipButton } from "@/components/ui/buttonStyles";

/** 買う必要がある人（「やりたい」を押した人）1人ぶん */
export type PurchasePerson = { userId: string; name: string; purchased: boolean };

/**
 * 「みんなでやりたい」のゲームの「買った」欄。グループ画面のカードと提案の詳細ページの両方で使う。
 *
 * - 自分が買う必要がある人なら「買った」の札（押すと付く・もう一度で外れる）
 * - 誰が買ったかを名前で並べる。**オーナーには他の人の名前も押せる札で出す**（押し忘れている人の代わりに付け外しする。
 *   2026-10-30 ユーザー判断）。判定はサーバー側（purchases の API）でも行う
 *
 * 全員そろうとサーバーがゲームリストの「プレイ予定」に入れるので、再取得でこの欄ごと消える
 * （詳細ページはゲーム詳細へ転送される）。
 */
export function ProposalPurchases({
  groupId,
  proposalId,
  people,
  currentUserId,
  isOwner,
}: {
  groupId: string;
  proposalId: string;
  people: PurchasePerson[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [local, setLocal] = useState(people);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setLocal(people), [people]);

  const me = local.find((p) => p.userId === currentUserId) ?? null;
  const boughtCount = local.filter((p) => p.purchased).length;

  async function setPurchased(userId: string, purchased: boolean) {
    if (pendingId) return;
    const previous = local;
    setLocal(previous.map((p) => (p.userId === userId ? { ...p, purchased } : p)));
    setPendingId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}/purchases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userId === currentUserId ? { purchased } : { purchased, userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "変更に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setLocal(previous);
      setError(e instanceof Error ? e.message : "変更に失敗しました");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div data-testid="proposal-purchases">
      <div className="flex flex-wrap items-center gap-2">
        {me && (
          <button
            onClick={() => setPurchased(me.userId, !me.purchased)}
            disabled={pendingId !== null}
            aria-pressed={me.purchased}
            className={chipButton(me.purchased)}
          >
            {me.purchased ? <Check size={15} aria-hidden="true" /> : <ShoppingCart size={15} aria-hidden="true" />}
            <span>買った</span>
          </button>
        )}
        {/* 1つの文字列として描く（Reactは隣り合うテキストを区切り、テストから拾えなくなる。docs/lessons.md） */}
        <span className="font-num text-sm text-steam-muted">{`買った ${boughtCount}/${local.length}人`}</span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="買ったかどうか">
        {local.map((p) => {
          const label = `${p.name}${p.userId === currentUserId ? "（あなた）" : ""}`;
          // オーナーは他の人の分も押せる。自分の分は上の「買った」で押す
          if (isOwner && p.userId !== currentUserId) {
            return (
              <li key={p.userId}>
                <button
                  onClick={() => setPurchased(p.userId, !p.purchased)}
                  disabled={pendingId !== null}
                  aria-pressed={p.purchased}
                  title={p.purchased ? `${p.name}さんの「買った」を外す` : `${p.name}さんの分を「買った」にする`}
                  className={chipButton(p.purchased)}
                >
                  {p.purchased && <Check size={15} aria-hidden="true" />}
                  <span>{label}</span>
                </button>
              </li>
            );
          }
          return (
            <li
              key={p.userId}
              data-purchased={p.purchased ? "true" : "false"}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                p.purchased ? "bg-steam-blue/15 text-steam-blue" : "bg-steam-bg text-steam-muted"
              }`}
            >
              {p.purchased && <Check size={13} aria-hidden="true" />}
              <span>{p.purchased ? label : `${label}・まだ`}</span>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
