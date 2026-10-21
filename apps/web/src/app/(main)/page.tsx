import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { RecentActivity } from "@/components/home/RecentActivity";
import { RecentActivity as GroupsActivity } from "@/components/group/RecentActivity";
import { getRecentActivityForGroups, type RecentDay } from "@/lib/activityFeed";
import { formatRelativeTime } from "@/lib/relative-time";
import { Film, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { primaryButton } from "@/components/ui/buttonStyles";

// ホーム：みんなの動き（所属グループすべて）+ 最近の投稿 + 自分が所属するグループのダッシュボード。
// 「みんなの動き」は 2026-10-21 に足した（ユーザー判断。最近の投稿の上、PCは左右に並べる）。
// 中身はグループ画面の「最近の動き」と同じ決まりで、各行にグループ名を添える（lib/activityFeed.ts の getRecentActivityForGroups）
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
  const [recentPhotos, activityDays] = await Promise.all([
    db.photo.findMany({
      where: {
        OR: [
          { album: { groupId: { in: groupIds } } },
          { albumId: null, uploaderId: user.id },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { uploader: true, album: true },
    }),
    // 取れなくてもホームの他の部分は出す（CLAUDE.md「外部依存はセクション単位で失敗させる」と同じ考え方）
    getRecentActivityForGroups(groups.map((g) => ({ id: g.id, name: g.name })), 8).catch((e): RecentDay[] => {
      console.error("[home] みんなの動きを読めませんでした", e);
      return [];
    }),
  ]);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
        ホーム
      </h1>

      {/* PC（1024px以上）は左に「みんなの動き」、右に「最近の投稿」。スマホは縦に並べる。
          片方しか無いときは左右に分けない（340pxの列に写真だけが詰め込まれる） */}
      <div
        className={
          activityDays.length > 0 && recentPhotos.length > 0
            ? "lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-6"
            : ""
        }
      >
        {activityDays.length > 0 && <GroupsActivity days={activityDays} title="みんなの動き" testId="home-activity" />}
        {recentPhotos.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold text-steam-text">
              最近の投稿
            </h2>
            <div className="mt-3">
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
      </div>

      <section className="mt-6">
        <h2 className="font-display text-xl font-bold text-steam-text">
          マイグループ
        </h2>
        {groups.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Users}
              title="まだグループがありません"
              description="グループを作って仲間を招待すると、ここに並びます。"
              action={<Link href="/groups/new" className={primaryButton}>グループを作る</Link>}
            />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="rounded-xl bg-steam-surface p-3 transition hover:border-steam-blue"
              >
                <p className="truncate font-display text-base font-semibold text-steam-text">
                  {group.name}
                </p>
                <div className="mt-2 flex items-center gap-3 text-sm text-steam-muted">
                  <span className="flex items-center gap-1">
                    <Film size={11} /> {group._count.albums}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={11} /> {group._count.members + 1}
                  </span>
                  <span className="ml-auto text-steam-muted">
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
