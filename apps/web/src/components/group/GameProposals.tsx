"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Plus, X, Search, ThumbsUp, HelpCircle, ThumbsDown, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PROPOSALS_PER_PROPOSER, groupProposalsByProposer } from "@/lib/proposalRanking";

type ReactionType = "LIKE" | "MAYBE" | "PASS";

type Proposal = {
  id: string;
  title: string;
  coverUrl: string | null;
  proposedById: string;
  proposedByName: string;
  /** 提案者が付けた順位。null＝順位なし（新しい順で並ぶ） */
  rank: number | null;
  /** 作成時刻（エポックミリ秒）。理由は lib/proposalRanking.ts の compareProposals */
  createdAt: number;
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
//
// **提案者ごとに区画を分けて出す。** 実際には各自のウィッシュリストとして使われていて、
// 1つの一覧に全員分を混ぜると件数が増えた時点で読めなくなった（友人からの要望）。
// 各区画は既定で5件。並びは「自分で付けた順位が先、残りは新しい順」で、
// 順位を付けていない人の見え方は従来と同じ（新しい順）。
//
// 区画分けと件数の切り出しは**取得済みのデータを並べ替えるだけ**で、クエリは増えない
// （グループ画面は提案を既に全件キャッシュから受け取っている）。
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
  const [localProposals, setLocalProposals] = useState(proposals);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [rankingId, setRankingId] = useState<string | null>(null);
  // 「他N件を表示」を押した区画。提案者IDで持つ
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setLocalProposals(proposals), [proposals]);

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
    const previous = localProposals;
    const tempProposal: Proposal = {
      id: `temp-${result.appId}`,
      title: result.name,
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
      proposedById: currentUserId,
      proposedByName: "あなた",
      rank: null,
      createdAt: Date.now(),
      reactions: [],
    };
    // 提案は即座に一覧へ反映し、モーダルも閉じてしまう（往復を待たせない）
    setLocalProposals([tempProposal, ...previous]);
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: tempProposal.coverUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "提案に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setLocalProposals(previous);
      setError(e instanceof Error ? e.message : "提案に失敗しました");
    }
  }

  async function react(proposalId: string, type: ReactionType) {
    const previous = localProposals;
    setLocalProposals(
      previous.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              reactions: [...p.reactions.filter((r) => r.userId !== currentUserId), { userId: currentUserId, type }],
            }
          : p
      )
    );
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
      setLocalProposals(previous);
      setError("リアクションに失敗しました");
    } finally {
      setReactingId(null);
    }
  }

  async function withdraw(proposalId: string) {
    const previous = localProposals;
    setLocalProposals(previous.filter((p) => p.id !== proposalId));
    setWithdrawingId(proposalId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setLocalProposals(previous);
      setError("取り下げに失敗しました");
    } finally {
      setWithdrawingId(null);
    }
  }

  /**
   * 順位を変える。**楽観更新はしない。**
   * 1件の順位を変えるとその人の他の提案も詰め直されるので、画面側で結果を予測すると
   * サーバーの詰め直しと食い違う。応答が返す新しい順位をそのまま反映する。
   */
  async function changeRank(proposalId: string, rank: number | null) {
    setRankingId(proposalId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/proposals/${proposalId}/rank`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rank }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: { ranks: { id: string; rank: number | null }[] } = await res.json();
      const next = new Map(data.ranks.map((r) => [r.id, r.rank]));
      setLocalProposals((prev) =>
        prev.map((p) => (next.has(p.id) ? { ...p, rank: next.get(p.id) ?? null } : p))
      );
      router.refresh();
    } catch {
      setError("順位の変更に失敗しました");
    } finally {
      setRankingId(null);
    }
  }

  const sections = groupProposalsByProposer(localProposals, currentUserId);

  return (
    <div>
      {/* 提案は「みんなのゲーム」とは別の話（まだリストに入っていない候補）なので独立させる。
          モーダルは畳んでも操作できるよう、開閉するセクションの外に置く。 */}
      <CollapsibleSection
        title="ゲーム提案"
        headerAction={
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
          >
            <Plus size={14} /> 提案する
          </button>
        }
      >
      {localProposals.length === 0 ? (
        <p className="mt-2 font-mono text-3xs text-steam-muted/70">まだ提案はありません。</p>
      ) : (
        <div className="mt-2 flex flex-col gap-5">
          {sections.map((section) => {
            const isMine = section.proposerId === currentUserId;
            const isExpanded = expanded.includes(section.proposerId);
            const visible = isExpanded
              ? section.proposals
              : section.proposals.slice(0, PROPOSALS_PER_PROPOSER);
            const hiddenCount = section.proposals.length - visible.length;

            return (
              <div key={section.proposerId}>
                {/* **1つの文字列として描く。** Reactは隣り合うテキストをコメントノードで
                    区切るため、`{name}・提案{n}件` と分けて書くと数字がテストから拾えない
                    （docs/lessons.md の「Reactは隣り合うテキストを区切る」） */}
                <p className="font-mono text-2xs text-steam-muted">
                  {`${section.proposerName}${isMine ? "（あなた）" : ""}・提案${section.proposals.length}件`}
                </p>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visible.map((p) => {
                    const likeCount = p.reactions.filter((r) => r.type === "LIKE").length;
                    const myReaction = p.reactions.find((r) => r.userId === currentUserId)?.type;
                    const canWithdraw = canManage || p.proposedById === currentUserId;
                    // 楽観的に差し込んだ仮の提案（temp-*）はまだサーバー上に無いので、
                    // リンクにも順位の変更対象にもしない
                    const isTemp = p.id.startsWith("temp-");

                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel p-2"
                      >
                        {p.coverUrl &&
                          (isTemp ? (
                            <Image
                              src={p.coverUrl}
                              alt={p.title}
                              width={80}
                              height={48}
                              className="h-12 w-20 flex-shrink-0 rounded-sm object-cover"
                            />
                          ) : (
                            <Link href={`/groups/${groupId}/proposals/${p.id}`} className="flex-shrink-0">
                              <Image
                                src={p.coverUrl}
                                alt={p.title}
                                width={80}
                                height={48}
                                className="h-12 w-20 rounded-sm object-cover transition hover:brightness-110"
                              />
                            </Link>
                          ))}
                        <div className="min-w-0 flex-1">
                          {isTemp ? (
                            <p className="truncate font-mono text-xs text-steam-text">{p.title}</p>
                          ) : (
                            <Link
                              href={`/groups/${groupId}/proposals/${p.id}`}
                              className="block truncate font-mono text-xs text-steam-text hover:text-steam-blue"
                            >
                              {p.title}
                            </Link>
                          )}
                          {/* 提案者は区画の見出しに出ているので、カードからは外した */}
                          <p className="truncate font-mono text-4xs text-steam-muted/70">
                            {`やりたい ${likeCount}/${likeThreshold}`}
                          </p>
                          <div className="mt-1 flex items-center gap-1">
                            {/* 順位は**提案者本人だけ**が変えられる（判定はサーバー側でも行う）。
                                他人のカードには出さない */}
                            {isMine && !isTemp && (
                              <select
                                value={p.rank ?? ""}
                                onChange={(e) =>
                                  changeRank(p.id, e.target.value === "" ? null : Number(e.target.value))
                                }
                                disabled={rankingId === p.id}
                                aria-label={`${p.title}の順位`}
                                className="flex-shrink-0 rounded-sm border border-steam-border bg-steam-bg px-1 py-0.5 font-mono text-4xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
                              >
                                <option value="">順位なし</option>
                                {Array.from({ length: PROPOSALS_PER_PROPOSER }, (_, i) => i + 1).map(
                                  (n) => (
                                    <option key={n} value={n}>
                                      {`${n}位`}
                                    </option>
                                  )
                                )}
                              </select>
                            )}
                            {REACTIONS.map(({ type, icon: Icon, label }) => {
                              const count = p.reactions.filter((r) => r.type === type).length;
                              const active = myReaction === type;
                              return (
                                <button
                                  key={type}
                                  onClick={() => react(p.id, type)}
                                  disabled={reactingId === p.id}
                                  title={label}
                                  className={`flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 font-mono text-4xs transition disabled:opacity-50 ${
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
                                aria-label="取り下げる"
                                className="ml-auto flex-shrink-0 p-1.5 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
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

                {hiddenCount > 0 && (
                  <button
                    onClick={() => setExpanded((prev) => [...prev, section.proposerId])}
                    className="mt-2 w-full rounded-sm border border-steam-border py-1.5 font-mono text-3xs text-steam-muted transition hover:border-steam-blue hover:text-steam-text"
                  >
                    {`他${hiddenCount}件を表示`}
                  </button>
                )}
                {isExpanded && section.proposals.length > PROPOSALS_PER_PROPOSER && (
                  <button
                    onClick={() =>
                      setExpanded((prev) => prev.filter((id) => id !== section.proposerId))
                    }
                    className="mt-2 w-full rounded-sm border border-steam-border py-1.5 font-mono text-3xs text-steam-muted transition hover:border-steam-blue hover:text-steam-text"
                  >
                    {`上位${PROPOSALS_PER_PROPOSER}件だけ表示`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">{error}</p>}
      </CollapsibleSection>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">ゲームを提案する</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="p-2 text-steam-muted hover:text-steam-text"
              >
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
                  className="flex items-center gap-3 rounded-sm border border-steam-border bg-steam-panel p-2 text-left transition hover:border-steam-blue"
                >
                  <Image
                    src={r.thumbnail}
                    alt=""
                    width={64}
                    height={40}
                    className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">{r.name}</span>
                </button>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="font-mono text-2xs text-steam-muted/70">見つかりませんでした</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
