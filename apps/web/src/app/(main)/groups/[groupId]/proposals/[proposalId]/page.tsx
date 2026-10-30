import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { steamHeaderImageUrl } from "@/lib/steam";
import { loadGameDetailData } from "@/lib/gameDetail";
import { GameNewsPanel } from "@/components/game/GameNewsPanel";
import { GamePricePanel } from "@/components/game/GamePricePanel";
import { GameReviewsPanel } from "@/components/game/GameReviewsPanel";
import { GameStoreBadges } from "@/components/game/GameStoreBadges";
import { GameVideoSection } from "@/components/game/GameVideoSection";
import { HltbCard } from "@/components/group/HltbCard";
import { ProposalVotePanel, type ProposalVoter } from "@/components/group/ProposalVotePanel";
import { ProposalPurchases } from "@/components/group/ProposalPurchases";
import { agreeThreshold, requiredPurchasers } from "@/lib/proposalPromotion";
import { badge, secondaryButton } from "@/components/ui/buttonStyles";

// 提案の詳細ページ：ゲーム詳細ページと同じSteam情報（レビュー・価格・ニュース・最安値）を出し、
// 投票（やりたい/様子見/パス）と、「みんなでやりたい」に上がったあとの「買った」もこのページから行えるようにする。
// 提案の段階では「このゲームを入れるべきか」を判断するための情報が要るのに、
// グループ詳細のカードにはタイトルとカバーしか出ていなかった。
//
// ゲーム詳細ページとの違い：
//   - HowLongToBeat・関連動画はExternalGameCacheに既にあるときだけ出す。
//     このページから外部APIを引きに行くことはしない（YouTubeのsearch.listはクォータが厳しく、
//     リンクのプリフェッチだけで消費されてしまうため）。採用されてリストに入った時点で埋まる。
//   - 採用済みの提案はゲーム詳細ページへ転送する（同じゲームの情報が2箇所に並ばないように）。
export default async function ProposalDetailPage(
  props: {
    params: Promise<{ groupId: string; proposalId: string }>;
  }
) {
  const params = await props.params;
  const currentUser = await getCurrentUser();
  if (!currentUser) notFound();

  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.groupId },
    include: {
      proposedBy: true,
      group: { select: { name: true, ownerId: true, owner: true, members: { include: { user: true } } } },
      reactions: { include: { user: true } },
      purchases: { select: { userId: true } },
    },
  });
  if (!proposal) notFound();

  // 採用済みなら、同じゲームのGroupGameが既にあるはずなのでそちらへ送る
  if (proposal.status === "ACCEPTED") {
    const promoted = await db.groupGame.findUnique({
      where: { groupId_steamAppId: { groupId: params.groupId, steamAppId: proposal.steamAppId } },
      select: { id: true },
    });
    if (promoted) redirect(`/groups/${params.groupId}/games/${promoted.id}`);
  }

  // 条件の式は lib/proposalPromotion.ts から取る（以前はここだけ過半数の式を書き写していた）
  const likeThreshold = agreeThreshold(proposal.group.ownerId, proposal.group.members.map((m) => m.userId));
  const isOpen = proposal.status === "PENDING" || proposal.status === "AGREED";

  // 「みんなでやりたい」の「買った」欄。買う必要があるのは「やりたい」を押した人のうち、今もグループにいる人
  const memberNames = new Map([
    [proposal.group.owner.id, proposal.group.owner.name ?? proposal.group.owner.email ?? "メンバー"],
    ...proposal.group.members.map((m) => [m.user.id, m.user.name ?? m.user.email ?? "メンバー"] as const),
  ]);
  const bought = new Set(proposal.purchases.map((p) => p.userId));
  const purchasePeople = requiredPurchasers(proposal.reactions, new Set(memberNames.keys())).map((userId) => ({
    userId,
    name: memberNames.get(userId) ?? "メンバー",
    purchased: bought.has(userId),
  }));

  const voters: ProposalVoter[] = proposal.reactions.map((r) => ({
    userId: r.userId,
    name: r.user.name ?? r.user.email ?? "メンバー",
    type: r.type,
  }));

  const canWithdraw =
    proposal.proposedById === currentUser.id ||
    (await hasGroupPermission(params.groupId, currentUser.id, "EDITOR"));

  const { reviews, reviewItems, price, news, itad } = await loadGameDetailData(proposal.steamAppId);

  // 既に他のグループが同じゲームを追加していればHLTB・動画が埋まっている（steamAppId単位の共有キャッシュ）
  const cache = await db.externalGameCache.findUnique({
    where: { steamAppId: proposal.steamAppId },
  });
  const youtubeVideoId =
    cache?.youtubeVideoId && /^[A-Za-z0-9_-]{11}$/.test(cache.youtubeVideoId)
      ? cache.youtubeVideoId
      : null;

  // キャッシュのheaderImageはappdetails由来の確実な値。提案作成時に固定パスを
  // 保存してしまった古い提案でも、これがあれば正しい画像で表示できる。
  const coverUrl =
    cache?.headerImage ?? proposal.coverUrl ?? steamHeaderImageUrl(proposal.steamAppId);

  return (
    <main className="p-4 sm:p-6">
      <Link
        href={`/groups/${params.groupId}`}
        className="inline-flex items-center gap-1.5 text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {proposal.group.name}に戻る
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：基本情報と投票 */}
        <div className="overflow-hidden rounded-xl bg-steam-surface">
          <div className="relative h-48 w-full overflow-hidden bg-steam-panel sm:h-64">
            <Image
              src={coverUrl}
              alt={proposal.title}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          </div>

          <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={badge(proposal.status === "AGREED" ? "blue" : "warning")}>
                {proposal.status === "PENDING" ? "投票中" : proposal.status === "AGREED" ? "みんなでやりたい" : "却下済み"}
              </span>
              <GameStoreBadges reviews={reviews} price={price} />
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold text-steam-text sm:text-3xl">
              {proposal.title}
            </h1>
            <p className="mt-1 text-xs text-steam-muted">
              {proposal.proposedBy.name ?? proposal.proposedBy.email ?? "メンバー"}が提案
            </p>

            {proposal.status === "AGREED" && (
              <div className="mt-3 rounded-xl bg-steam-panel p-4">
                <h2 className="text-base font-bold text-steam-text">買った？</h2>
                <p className="mt-1 text-sm text-steam-muted">
                  「やりたい」を押した人が全員「買った」になると、ゲームリストの「プレイ予定」に入ります（元から持っている・無料のときも「買った」を押してください）
                </p>
                <div className="mt-3">
                  <ProposalPurchases
                    groupId={params.groupId}
                    proposalId={proposal.id}
                    people={purchasePeople}
                    currentUserId={currentUser.id}
                    isOwner={proposal.group.ownerId === currentUser.id}
                  />
                </div>
              </div>
            )}

            <div className="mt-3">
              {isOpen ? (
                <ProposalVotePanel
                  groupId={params.groupId}
                  proposalId={proposal.id}
                  voters={voters}
                  currentUserId={currentUser.id}
                  likeThreshold={likeThreshold}
                  agreed={proposal.status === "AGREED"}
                  canWithdraw={canWithdraw}
                />
              ) : (
                <p className="rounded-xl bg-steam-panel p-4 text-sm text-steam-muted">
                  この提案は決着済みのため投票できません。
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://store.steampowered.com/app/${proposal.steamAppId}`}
                target="_blank"
                rel="noreferrer"
                className={secondaryButton}
              >
                <ExternalLink size={16} aria-hidden="true" /> Steamストアで見る
              </a>
            </div>

            <div className="mt-4">
              <GameVideoSection title={proposal.title} youtubeVideoId={youtubeVideoId} />
            </div>
          </div>
        </div>

        {/* 右：最新ニュース全文 + レビュー + 価格の値動き */}
        <div className="flex flex-col gap-4">
          <GameNewsPanel news={news} />
          <GameReviewsPanel reviews={reviewItems} />
          <GamePricePanel price={price} itad={itad} />

          {/* 取れなかったときも枠は出す（「データなし」と書く。HltbCard のコメント） */}
          <HltbCard
            gameId={cache?.hltbGameId ?? null}
            main={cache?.hltbMainHours ?? null}
            mainExtra={cache?.hltbMainExtraHours ?? null}
            completionist={cache?.hltbCompletionistHours ?? null}
            allStyles={cache?.hltbAllStylesHours ?? null}
          />
        </div>
      </div>
    </main>
  );
}
