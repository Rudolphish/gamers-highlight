"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Bookmark, Plus, X, Search, ThumbsUp, Meh, Minus, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { PROPOSAL_REACTION_LABELS } from "@/lib/gameLabels";
import { addButton, chipButton, dangerIconButton, fieldClass, ghostIconButton, secondaryButton } from "@/components/ui/buttonStyles";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { modalOverlay, modalPanel } from "@/components/ui/modalStyles";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PROPOSALS_PER_PROPOSER, groupProposalsByProposer } from "@/lib/proposalRanking";
import type { WishlistPrice } from "@/lib/wishlistPrice";
import { PriceLine } from "./WishlistPriceLine";
import { AgreedProposals, type AgreedProposal } from "./AgreedProposals";
import { EmptyState } from "@/components/ui/EmptyState";

type ReactionType = "LIKE" | "MAYBE" | "PASS";

type Proposal = {
  id: string;
  steamAppId: number;
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
  { type: "LIKE", icon: ThumbsUp, label: PROPOSAL_REACTION_LABELS.LIKE },
  { type: "MAYBE", icon: Meh, label: PROPOSAL_REACTION_LABELS.MAYBE },
  { type: "PASS", icon: Minus, label: PROPOSAL_REACTION_LABELS.PASS },
];

// ゲーム提案機能：メンバーが提案→他メンバーがリアクション→全員が「やりたい」を押すと
// 「みんなでやりたい」（AgreedProposals）へ上がる→やりたい人が全員「買った」を押すとゲームリストの「プレイ予定」に入る
// （判定はサーバー側。lib/proposalPromotion.ts）。「みんなでやりたい」はこの部品の上に出す（価格の取得を共有するため）。
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
  agreed,
  currentUserId,
  likeThreshold,
  canManage,
  isOwner,
}: {
  groupId: string;
  proposals: Proposal[];
  /** 「みんなでやりたい」に上がった提案 */
  agreed: AgreedProposal[];
  currentUserId: string;
  /** 「みんなでやりたい」に上がるのに要る「やりたい」の数（＝グループの全員） */
  likeThreshold: number;
  canManage: boolean;
  /** オーナーは他の人の「買った」も付け外しできる */
  isOwner: boolean;
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
  // 取り下げの確認を出している提案。ゴミ箱を押しただけでは消さない（押し間違えた報告があった）
  const [confirming, setConfirming] = useState<{ id: string; title: string } | null>(null);
  const [rankingId, setRankingId] = useState<string | null>(null);
  // 「他N件を表示」を押した区画。提案者IDで持つ
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 価格（Steamの今の値段と過去最安値）。null＝読み込み中。カードは先に出し、価格はあとから入れる
  // （外部への問い合わせがゲームの数だけ要るので、グループ画面の描画には混ぜていない。API側のコメント参照）
  const [prices, setPrices] = useState<Record<number, WishlistPrice> | null>(null);

  // サーバーから届いた一覧のゲームが変わったときだけ読み直す（リアクションや順位の変更では読まない）
  const priceKey = Array.from(new Set([...proposals, ...agreed].map((p) => p.steamAppId)))
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    if (!priceKey) return;
    let cancelled = false;
    fetch(`/api/groups/${groupId}/proposals/prices`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setPrices(data?.prices ?? {});
      })
      .catch(() => {
        // 取れなくてもカードはそのまま使える。価格の行を出さないだけ
        if (!cancelled) setPrices({});
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, priceKey]);

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
      steamAppId: result.appId,
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
    <div className="flex flex-col gap-8">
      <AgreedProposals groupId={groupId} items={agreed} currentUserId={currentUserId} isOwner={isOwner} prices={prices} />

      {/* 提案は「みんなのゲーム」とは別の話（まだリストに入っていない候補）なので独立させる。
          モーダルは畳んでも操作できるよう、開閉するセクションの外に置く。 */}
      <CollapsibleSection
        title="ウィッシュリスト"
        headerAction={
          <button onClick={() => setOpen(true)} className={addButton}>
            <Plus size={16} aria-hidden="true" /> 追加する
          </button>
        }
      >
      {localProposals.length === 0 ? (
        <EmptyState icon={Bookmark} title="まだウィッシュリストは空です" description="「追加する」から、みんなでやりたいゲームを提案できます。" />
      ) : (
        // 1280px以上はグループ画面の下に幅いっぱいで置かれる（GroupSections）。提案者1人を1列にして横に並べ、
        // 入りきらない人は次の段へ回す。1列の幅は300px以上（リアクションの札3つが1行に収まる幅）。
        // `auto-fill` なので人数が少なくても列は広がらず、カードが横に間延びしない
        <div className="mt-2 flex flex-col gap-5 xl:grid xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] xl:items-start">
          {sections.map((section) => {
            const isMine = section.proposerId === currentUserId;
            const isExpanded = expanded.includes(section.proposerId);
            const visible = isExpanded
              ? section.proposals
              : section.proposals.slice(0, PROPOSALS_PER_PROPOSER);
            const hiddenCount = section.proposals.length - visible.length;

            return (
              <div key={section.proposerId} data-testid="proposer-section">
                {/* **1つの文字列として描く。** Reactは隣り合うテキストをコメントノードで
                    区切るため、`{name}・提案{n}件` と分けて書くと数字がテストから拾えない
                    （docs/lessons.md の「Reactは隣り合うテキストを区切る」） */}
                <p className="text-sm font-bold text-steam-muted">
                  {`${section.proposerName}${isMine ? "（あなた）" : ""}・${section.proposals.length}件`}
                </p>

                {/* 1280px以上では提案者ごとの列に入るので1列に戻す。画面幅で決まるため、列の幅ではなく xl で切り替える */}
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  {visible.map((p) => {
                    const likeCount = p.reactions.filter((r) => r.type === "LIKE").length;
                    const myReaction = p.reactions.find((r) => r.userId === currentUserId)?.type;
                    const canWithdraw = canManage || p.proposedById === currentUserId;
                    // 楽観的に差し込んだ仮の提案（temp-*）はまだサーバー上に無いので、
                    // リンクにも順位の変更対象にもしない
                    const isTemp = p.id.startsWith("temp-");

                    return (
                      <div key={p.id} className="rounded-xl bg-steam-panel p-3">
                        <div className="flex items-start gap-3">
                          {p.coverUrl &&
                            (isTemp ? (
                              <Image
                                src={p.coverUrl}
                                alt={p.title}
                                width={80}
                                height={48}
                                className="h-12 w-20 flex-shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <Link href={`/groups/${groupId}/proposals/${p.id}`} className="flex-shrink-0">
                                <Image
                                  src={p.coverUrl}
                                  alt={p.title}
                                  width={80}
                                  height={48}
                                  className="h-12 w-20 rounded-lg object-cover transition hover:brightness-110"
                                />
                              </Link>
                            ))}
                          <div className="min-w-0 flex-1">
                            {isTemp ? (
                              <p className="truncate text-sm font-bold text-steam-text">{p.title}</p>
                            ) : (
                              <Link
                                href={`/groups/${groupId}/proposals/${p.id}`}
                                className="block truncate text-sm font-bold text-steam-text hover:text-steam-blue"
                              >
                                {p.title}
                              </Link>
                            )}
                            {/* 提案者は区画の見出しに出ているので、カードからは外した */}
                            <p className="truncate text-xs text-steam-muted">
                              {`「${PROPOSAL_REACTION_LABELS.LIKE}」${likeCount}/${likeThreshold}人で「みんなでやりたい」へ`}
                            </p>
                            {/* 順位は**提案者本人だけ**が変えられる（判定はサーバー側でも行う）。
                                他人のカードには出さない */}
                            {isMine && !isTemp && (
                              <select
                                value={p.rank ?? ""}
                                onChange={(e) => changeRank(p.id, e.target.value === "" ? null : Number(e.target.value))}
                                disabled={rankingId === p.id}
                                aria-label={`${p.title}の順位`}
                                className={`${fieldClass} mt-1.5`}
                              >
                                <option value="">順位なし</option>
                                {Array.from({ length: PROPOSALS_PER_PROPOSER }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>
                                    {`${n}位`}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          {canWithdraw && (
                            <button
                              onClick={() => setConfirming({ id: p.id, title: p.title })}
                              disabled={withdrawingId === p.id}
                              title="取り下げる"
                              aria-label="取り下げる"
                              className={`${dangerIconButton} -mr-1 -mt-1`}
                            >
                              {withdrawingId === p.id ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
                            </button>
                          )}
                        </div>
                        {/* 価格の行はカードの幅いっぱいに出す。題名の欄（画像と取り下げボタンの間）に入れると、
                            スマホで「最安 ¥…」が切れた（B119） */}
                        {!isTemp && (
                          <div className="mt-2">
                            <PriceLine price={prices === null ? "loading" : prices[p.steamAppId]} />
                          </div>
                        )}
                        {/* リアクションは文字付きで出す（以前はアイコンと数だけで、何の数か分からなかった） */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {REACTIONS.map(({ type, icon: Icon, label }) => {
                            const count = p.reactions.filter((r) => r.type === type).length;
                            const active = myReaction === type;
                            return (
                              <button
                                key={type}
                                onClick={() => react(p.id, type)}
                                disabled={reactingId === p.id}
                                aria-pressed={active}
                                className={chipButton(active)}
                              >
                                <Icon size={15} aria-hidden="true" />
                                <span>{count > 0 ? `${label} ${count}` : label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hiddenCount > 0 && (
                  <button
                    onClick={() => setExpanded((prev) => [...prev, section.proposerId])}
                    className={`${secondaryButton} mt-2 w-full`}
                  >
                    {`他${hiddenCount}件を表示`}
                  </button>
                )}
                {isExpanded && section.proposals.length > PROPOSALS_PER_PROPOSER && (
                  <button
                    onClick={() =>
                      setExpanded((prev) => prev.filter((id) => id !== section.proposerId))
                    }
                    className={`${secondaryButton} mt-2 w-full`}
                  >
                    {`上位${PROPOSALS_PER_PROPOSER}件だけ表示`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </CollapsibleSection>

      {confirming && (
        <ConfirmDialog
          title="提案を取り下げますか？"
          message={`「${confirming.title}」をウィッシュリストから外します。付いている投票も消え、元に戻せません。`}
          confirmLabel="取り下げる"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            // 一覧からはすぐ消える（楽観的に外す）ので、確認は待たずに閉じる
            const id = confirming.id;
            setConfirming(null);
            withdraw(id);
          }}
        />
      )}

      {open && (
        <div className={modalOverlay}>
          <div className={modalPanel}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">ウィッシュリストに追加</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className={ghostIconButton}
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
                className="flex-1 rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-accent px-3 py-2 text-xs font-bold text-accent-ink disabled:opacity-40"
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
                  className="flex items-center gap-3 rounded-lg bg-steam-panel p-2 text-left transition hover:border-steam-blue"
                >
                  <Image
                    src={r.thumbnail}
                    alt=""
                    width={64}
                    height={40}
                    className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-steam-text">{r.name}</span>
                </button>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="text-2xs text-steam-muted">見つかりませんでした</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
