import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { RecentActivity } from "@/components/home/RecentActivity";
import { formatRelativeTime } from "@/lib/relative-time";
import { Film, Users } from "lucide-react";

// ホーム：最近の投稿 + 自分が所属するグループのダッシュボード
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null; // middlewareで弾かれるはずなのでここには来ない想定
  }

  const user = await getCurrentUser();
  if (!user) return null;

  const groups = await db.group.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { albums: true, members: true } },
    },
  });

  const groupIds = groups.map((g) => g.id);

  // 所属グループ配下の全アルバムの投稿だけでなく、自分がアップロードした
  // 「未分類（albumIdなし）」の投稿も拾う。未分類のままだとどのアルバムページにも
  // 表示されず埋もれてしまうため、少なくともホーム画面だけは必ず見えるようにしておく。
  const recentPhotos = await db.photo.findMany({
    where: {
      OR: [
        { album: { groupId: { in: groupIds } } },
        { albumId: null, uploaderId: user.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { uploader: true, album: true },
  });

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
        ホーム
      </h1>

      {recentPhotos.length > 0 && (
        <section className="mt-5">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-steam-muted">
            最近の投稿
          </h2>
          <div className="mt-2">
            <RecentActivity
              photos={recentPhotos.map((p) => ({
                id: p.id,
                mediaType: p.mediaType,
                mediaUrl: p.mediaUrl,
                thumbnailUrl: p.thumbnailUrl,
                durationSeconds: p.durationSeconds,
                createdAt: p.createdAt,
                albumId: p.albumId,
                albumTitle: p.album?.title,
                uploaderName: p.uploader.name ?? p.uploader.email,
              }))}
            />
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-steam-muted">
          マイグループ
        </h2>
        {groups.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-steam-muted">
            まだグループがありません。作成して仲間を招待しましょう。
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="rounded-sm border border-steam-border bg-steam-surface p-3 transition hover:border-steam-blue"
              >
                <p className="truncate font-display text-base font-semibold text-steam-text">
                  {group.name}
                </p>
                <div className="mt-2 flex items-center gap-3 font-mono text-3xs text-steam-muted">
                  <span className="flex items-center gap-1">
                    <Film size={11} /> {group._count.albums}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={11} /> {group._count.members + 1}
                  </span>
                  <span className="ml-auto text-steam-muted/70">
                    {formatRelativeTime(group.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
