import { notFound } from "next/navigation";
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
import { InterestButton } from "@/components/group/InterestButton";
import { RefreshGameDataButton } from "@/components/group/RefreshGameDataButton";
import { REFRESH_INTERVAL_MS } from "@/lib/externalGameCache";

const STATUS_LABEL = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
} as const;

// ゲーム詳細ページ：左にSteamの基本情報（レビュー・現在価格・リンク・関連動画）、
// 右上に最新ニュースの全文、右下に価格情報（IsThereAnyDeal API）を配置する。
// 各パネルと外部情報の取得は提案の詳細ページと共通（components/game/・lib/gameDetail.ts）。
// 関連動画（YouTube）はゲームをリストに追加した時点で1回だけ検索してDBに保存したものを表示する
// （search.listはクォータ消費が大きいため、ページ表示のたびには検索しない）。
// いずれも外部サービス依存のため、個別に失敗してもページ全体は壊さずそのセクションだけ非表示にする。
// HowLongToBeatは過去3回断念したが、4度目でユーザーが見つけた現行の非公式スクレイパーの
// 実装を参考に成功。ゲーム追加時に1回だけ取得してDB保存する（lib/hltb.ts参照）。
export default async function GroupGameDetailPage({
  params,
}: {
  params: { groupId: string; gameId: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) notFound();

  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  const game = await db.groupGame.findUnique({
    where: { id: params.gameId, groupId: params.groupId },
    include: { addedBy: true, group: true, interests: { include: { user: true } } },
  });
  if (!game) notFound();

  const interestedUsers = game.interests.map((i) => ({
    id: i.userId,
    name: i.user.name ?? i.user.email ?? "メンバー",
  }));

  // 外部情報の最終更新時刻。ExternalGameCacheはsteamAppId単位でグループ横断に共有されるため、
  // 更新間隔の制限もグループをまたいで共有される
  const cache = await db.externalGameCache.findUnique({
    where: { steamAppId: game.steamAppId },
    select: { updatedAt: true },
  });
  const canRefresh = await hasGroupPermission(params.groupId, currentUser.id, "EDITOR");

  const { reviews, reviewItems, price, news, itad } = await loadGameDetailData(game.steamAppId);

  const coverUrl = game.coverUrl ?? steamHeaderImageUrl(game.steamAppId);
  // 保存時に検証済みだが、埋め込みsrcに使う前に念のため形式を再チェックする
  const youtubeVideoId =
    game.youtubeVideoId && /^[A-Za-z0-9_-]{11}$/.test(game.youtubeVideoId) ? game.youtubeVideoId : null;

  return (
    <main className="p-4 sm:p-6">
      <Link
        href={`/groups/${params.groupId}`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {game.group.name}に戻る
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：基本情報 */}
        <div className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface">
          <div className="relative h-48 w-full overflow-hidden bg-steam-panel sm:h-64">
            <Image src={coverUrl} alt={game.title} fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" priority />
          </div>

          <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-sm border border-steam-blue/50 px-1.5 py-0.5 font-mono text-3xs text-steam-blue">
                {STATUS_LABEL[game.status]}
              </span>
              <GameStoreBadges reviews={reviews} price={price} />
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold text-steam-text sm:text-3xl">
              {game.title}
            </h1>
            <p className="mt-1 font-mono text-xs text-steam-muted">
              {game.addedBy.name ?? game.addedBy.email ?? "メンバー"}が追加
            </p>

            <div className="mt-3">
              <InterestButton
                groupId={params.groupId}
                gameId={game.id}
                users={interestedUsers}
                currentUserId={currentUser.id}
                showNames
              />
            </div>

            <div className="mt-3">
              <RefreshGameDataButton
                groupId={params.groupId}
                gameId={game.id}
                refreshedAt={cache?.updatedAt.toISOString() ?? null}
                nextAvailableAt={
                  cache ? new Date(cache.updatedAt.getTime() + REFRESH_INTERVAL_MS).toISOString() : null
                }
                canRefresh={canRefresh}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://store.steampowered.com/app/${game.steamAppId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
              >
                <ExternalLink size={13} /> Steamストアで見る
              </a>
            </div>

            <div className="mt-4">
              <GameVideoSection title={game.title} youtubeVideoId={youtubeVideoId} />
            </div>
          </div>
        </div>

        {/* 右：最新ニュース全文 + レビュー + 価格の値動き */}
        <div className="flex flex-col gap-4">
          <GameNewsPanel news={news} />
          <GameReviewsPanel reviews={reviewItems} />
          <GamePricePanel price={price} itad={itad} />

          {/* 項目ごとに収録状況が違うため、1つでも時間が取れていればカードを出す */}
          {game.hltbGameId !== null &&
            (game.hltbMainHours !== null ||
              game.hltbMainExtraHours !== null ||
              game.hltbCompletionistHours !== null ||
              game.hltbAllStylesHours !== null) && (
              <HltbCard
                gameId={game.hltbGameId}
                main={game.hltbMainHours}
                mainExtra={game.hltbMainExtraHours}
                completionist={game.hltbCompletionistHours}
                allStyles={game.hltbAllStylesHours}
              />
            )}
        </div>
      </div>
    </main>
  );
}
