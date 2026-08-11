import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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

// 提案の詳細ページ：ゲーム詳細ページと同じSteam情報（レビュー・価格・ニュース・最安値）を出し、
// 投票（やりたい/気になる/興味なし）もこのページから行えるようにする。
// 提案の段階では「このゲームを入れるべきか」を判断するための情報が要るのに、
// グループ詳細のカードにはタイトルとカバーしか出ていなかった。
//
// ゲーム詳細ページとの違い：
//   - HowLongToBeat・関連動画はExternalGameCacheに既にあるときだけ出す。
//     このページから外部APIを引きに行くことはしない（YouTubeのsearch.listはクォータが厳しく、
//     リンクのプリフェッチだけで消費されてしまうため）。採用されてリストに入った時点で埋まる。
//   - 採用済みの提案はゲーム詳細ページへ転送する（同じゲームの情報が2箇所に並ばないように）。
export default async function ProposalDetailPage({
  params,
}: {
  params: { groupId: string; proposalId: string };
}) {
  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!currentUser) notFound();

  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.groupId },
    include: {
      proposedBy: true,
      group: { select: { name: true, _count: { select: { members: true } } } },
      reactions: { include: { user: true } },
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

  const totalMembers = 1 + proposal.group._count.members; // オーナー分+1
  const likeThreshold = Math.floor(totalMembers / 2) + 1;

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
        className="inline-flex items-center gap-1.5 font-mono text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {proposal.group.name}に戻る
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：基本情報と投票 */}
        <div className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface">
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
              <span className="rounded-sm border border-[#e0a323]/50 px-1.5 py-0.5 font-mono text-3xs text-[#e0a323]">
                {proposal.status === "PENDING" ? "投票中" : "却下済み"}
              </span>
              <GameStoreBadges reviews={reviews} price={price} />
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold text-steam-text sm:text-3xl">
              {proposal.title}
            </h1>
            <p className="mt-1 font-mono text-xs text-steam-muted">
              {proposal.proposedBy.name ?? proposal.proposedBy.email ?? "メンバー"}が提案
            </p>

            <div className="mt-3">
              {proposal.status === "PENDING" ? (
                <ProposalVotePanel
                  groupId={params.groupId}
                  proposalId={proposal.id}
                  voters={voters}
                  currentUserId={currentUser.id}
                  likeThreshold={likeThreshold}
                  canWithdraw={canWithdraw}
                />
              ) : (
                <p className="rounded-sm border border-steam-border bg-steam-panel p-3 font-mono text-3xs text-steam-muted">
                  この提案は決着済みのため投票できません。
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://store.steampowered.com/app/${proposal.steamAppId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
              >
                <ExternalLink size={13} /> Steamストアで見る
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

          {cache?.hltbGameId != null &&
            (cache.hltbMainHours !== null ||
              cache.hltbMainExtraHours !== null ||
              cache.hltbCompletionistHours !== null ||
              cache.hltbAllStylesHours !== null) && (
              <HltbCard
                gameId={cache.hltbGameId}
                main={cache.hltbMainHours}
                mainExtra={cache.hltbMainExtraHours}
                completionist={cache.hltbCompletionistHours}
                allStyles={cache.hltbAllStylesHours}
              />
            )}
        </div>
      </div>
    </main>
  );
}
