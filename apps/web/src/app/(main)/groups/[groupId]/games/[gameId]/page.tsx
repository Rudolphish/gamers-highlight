import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { steamHeaderImageUrl } from "@/lib/steam";

const STATUS_LABEL = {
  WISHLIST: "気になる",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
} as const;

// ゲーム詳細ページ：現状はタイトル・ステータス・Steamストアへのリンクのみ。
// Steamレビュー/関連YouTube動画などはroadmap.md Phase 6の後続タスクで追加予定。
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
          <span className="rounded-sm border border-steam-blue/50 px-1.5 py-0.5 font-mono text-[10px] text-steam-blue">
            {STATUS_LABEL[game.status]}
          </span>
          <h1 className="mt-2 font-display text-2xl font-bold text-steam-text sm:text-3xl">
            {game.title}
          </h1>
          <p className="mt-1 font-mono text-xs text-steam-muted">
            {game.addedBy.name ?? game.addedBy.email ?? "メンバー"}が追加
          </p>

          <a
            href={`https://store.steampowered.com/app/${game.steamAppId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
          >
            <ExternalLink size={13} /> Steamストアで見る
          </a>

          <p className="mt-6 font-mono text-[11px] text-steam-muted/60">
            レビューや関連動画などの情報は今後追加予定です。
          </p>
        </div>
      </div>
    </main>
  );
}
