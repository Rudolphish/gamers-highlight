import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ExternalLink, MessageSquare, Newspaper, ThumbsDown, ThumbsUp, TrendingDown, Youtube } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import {
  getSteamNews,
  getSteamPriceInfo,
  getSteamReviews,
  getSteamReviewSummary,
  steamHeaderImageUrl,
  stripSteamBBCode,
} from "@/lib/steam";
import { getItadSummary } from "@/lib/itad";
import { HltbCard } from "@/components/group/HltbCard";
import { InterestButton } from "@/components/group/InterestButton";

const STATUS_LABEL = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
} as const;

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

// SteamニュースのcontentsはBBCode/HTMLタグが混じるため、そのまま描画せず
// タグ類を除去したプレーンテキストの段落配列に変換する（XSS対策）。
function newsContentToParagraphs(raw: string): string[] {
  return stripSteamBBCode(raw)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ゲーム詳細ページ：左にSteamの基本情報（レビュー・現在価格・リンク・関連動画）、
// 右上に最新ニュースの全文、右下に価格情報（IsThereAnyDeal API）を配置する。
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
  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
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

  const [reviewResult, reviewItemsResult, priceResult, newsResult, itadResult] = await Promise.allSettled([
    getSteamReviewSummary(game.steamAppId),
    getSteamReviews(game.steamAppId, 3),
    getSteamPriceInfo(game.steamAppId),
    getSteamNews(game.steamAppId, 3, 4000),
    getItadSummary(game.steamAppId),
  ]);

  const reviews = settled(reviewResult);
  const reviewItems = settled(reviewItemsResult) ?? [];
  const price = settled(priceResult);
  const news = settled(newsResult) ?? [];
  const itad = settled(itadResult);

  const [latestNews, ...otherNews] = news;
  const latestNewsParagraphs = latestNews ? newsContentToParagraphs(latestNews.contents) : [];

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
              <span className="rounded-sm border border-steam-blue/50 px-1.5 py-0.5 font-mono text-[10px] text-steam-blue">
                {STATUS_LABEL[game.status]}
              </span>
              {reviews && (
                <span className="rounded-sm border border-[#a4d007]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#a4d007]">
                  {reviews.scoreDesc}（{reviews.totalReviews.toLocaleString()}件）
                </span>
              )}
              {price && (
                <span className="rounded-sm border border-steam-border px-1.5 py-0.5 font-mono text-[10px] text-steam-text">
                  {price.isFree
                    ? "無料"
                    : price.discountPercent > 0
                      ? `${price.finalFormatted}（-${price.discountPercent}%）`
                      : price.finalFormatted}
                </span>
              )}
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
              <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
                <Youtube size={12} /> 関連動画
              </h2>
              {youtubeVideoId && (
                <div className="mt-2 aspect-video w-full overflow-hidden rounded-sm border border-steam-border">
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                    title="関連動画"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              )}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${game.title} gameplay`)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] text-steam-blue hover:underline"
              >
                <ExternalLink size={11} /> YouTubeで他の動画を探す
              </a>
            </div>
          </div>
        </div>

        {/* 右：最新ニュース全文 + 価格の値動き */}
        <div className="flex flex-col gap-4">
          {latestNews && (
            <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
              <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
                <Newspaper size={12} /> 最新ニュース
              </h2>
              <a
                href={latestNews.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block font-display text-base font-semibold text-steam-text hover:text-steam-blue"
              >
                {latestNews.title}
              </a>
              <p className="mt-0.5 font-mono text-[9px] text-steam-muted/70">
                {new Date(latestNews.date * 1000).toLocaleDateString("ja-JP")}
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed text-steam-muted">
                {latestNewsParagraphs.length > 0 ? (
                  latestNewsParagraphs.map((p, i) => <p key={i} className="mt-2 first:mt-0">{p}</p>)
                ) : (
                  <p>本文はSteamストアページでご確認ください。</p>
                )}
              </div>

              {otherNews.length > 0 && (
                <div className="mt-4 space-y-1.5 border-t border-steam-border pt-3">
                  {otherNews.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-mono text-[10px] text-steam-muted hover:text-steam-blue"
                    >
                      {item.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {reviewItems.length > 0 && (
            <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
              <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
                <MessageSquare size={12} /> レビュー
              </h2>
              <div className="mt-2 flex flex-col gap-3">
                {reviewItems.map((r) => (
                  <div key={r.id} className="border-t border-steam-border pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-1.5 font-mono text-[9px] text-steam-muted/70">
                      {r.votedUp ? (
                        <ThumbsUp size={11} className="text-[#a4d007]" />
                      ) : (
                        <ThumbsDown size={11} className="text-[#eb4b4b]" />
                      )}
                      <span>プレイ時間 {r.playtimeHours}h</span>
                      <span>・{new Date(r.createdAt * 1000).toLocaleDateString("ja-JP")}</span>
                    </div>
                    <p className="mt-1 line-clamp-4 font-mono text-xs leading-relaxed text-steam-text">
                      {r.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {itad && (
            <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
              <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
                <TrendingDown size={12} /> 価格情報
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-steam-border bg-steam-panel p-3 text-center">
                  <p className="font-mono text-[9px] text-steam-muted">現在価格（Steam）</p>
                  <p className="mt-1 font-display text-lg font-bold text-steam-text">
                    {price ? (price.isFree ? "無料" : price.finalFormatted) : "-"}
                  </p>
                </div>
                <div className="rounded-sm border border-steam-border bg-steam-panel p-3 text-center">
                  <p className="font-mono text-[9px] text-steam-muted">過去最安値（全ストア）</p>
                  <p className="mt-1 font-display text-lg font-bold text-[#a4d007]">
                    ¥{itad.lowPrice.toLocaleString("ja-JP")}
                  </p>
                  <p className="font-mono text-[9px] text-steam-muted/70">
                    {itad.lowShopName}
                    {itad.lowCut > 0 ? `（-${itad.lowCut}%）` : ""}
                  </p>
                </div>
              </div>
              <a
                href={itad.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] text-steam-blue hover:underline"
              >
                <ExternalLink size={11} /> IsThereAnyDealで全ストアの価格を比較する
              </a>
            </div>
          )}

          {game.hltbGameId !== null &&
            game.hltbMainHours !== null &&
            game.hltbMainExtraHours !== null &&
            game.hltbCompletionistHours !== null &&
            game.hltbAllStylesHours !== null && (
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
