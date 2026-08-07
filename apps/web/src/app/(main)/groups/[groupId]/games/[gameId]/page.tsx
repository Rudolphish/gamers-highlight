import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Newspaper } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import {
  getSteamNews,
  getSteamPriceInfo,
  getSteamReviewSummary,
  steamHeaderImageUrl,
} from "@/lib/steam";

const STATUS_LABEL = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
} as const;

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

// ゲーム詳細ページ：Steamレビュー・現在価格・最新ニュースを1ページに集約する。
// いずれも外部サービス依存のため、個別に失敗してもページ全体は壊さずそのセクションだけ非表示にする。
// HowLongToBeat連携は検討したが、先方が検索APIを頻繁に変更しトークン認証まで要求するため
// メンテコストに見合わないと判断し見送った（docs/ideas.mdに記録）。
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
    include: { addedBy: true, group: true },
  });
  if (!game) notFound();

  const [reviewResult, priceResult, newsResult] = await Promise.allSettled([
    getSteamReviewSummary(game.steamAppId),
    getSteamPriceInfo(game.steamAppId),
    getSteamNews(game.steamAppId, 3),
  ]);

  const reviews = settled(reviewResult);
  const price = settled(priceResult);
  const news = settled(newsResult) ?? [];

  const coverUrl = game.coverUrl ?? steamHeaderImageUrl(game.steamAppId);

  return (
    <main className="p-4 sm:p-6">
      <Link
        href={`/groups/${params.groupId}`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {game.group.name}に戻る
      </Link>

      <div className="mt-4 max-w-2xl overflow-hidden rounded-sm border border-steam-border bg-steam-surface">
        <div className="relative h-48 w-full overflow-hidden bg-steam-panel sm:h-64">
          <img src={coverUrl} alt={game.title} className="h-full w-full object-cover" />
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

          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={`https://store.steampowered.com/app/${game.steamAppId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
            >
              <ExternalLink size={13} /> Steamストアで見る
            </a>
            <a
              href={`https://howlongtobeat.com/?q=${encodeURIComponent(game.title)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text transition hover:border-steam-blue"
            >
              <ExternalLink size={13} /> HowLongToBeatで見る
            </a>
          </div>

          {news.length > 0 && (
            <div className="mt-6">
              <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
                <Newspaper size={12} /> 最新ニュース
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {news.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm border border-steam-border bg-steam-panel p-2 transition hover:border-steam-blue"
                  >
                    <p className="line-clamp-2 font-mono text-xs text-steam-text">{item.title}</p>
                    <p className="mt-1 font-mono text-[9px] text-steam-muted/70">
                      {new Date(item.date * 1000).toLocaleDateString("ja-JP")}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
