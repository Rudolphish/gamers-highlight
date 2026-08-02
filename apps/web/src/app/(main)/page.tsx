import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { AlbumGrid } from "@/components/album/AlbumGrid";
import { RecentActivity } from "@/components/home/RecentActivity";

// ホーム：最近の投稿 + 自分と共有されたアルバムのダッシュボード
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null; // middlewareで弾かれるはずなのでここには来ない想定
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  if (!user) return null;

  const albums = await db.album.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: true,
      members: {
        orderBy: { invitedAt: "asc" },
        take: 4,
        include: { user: true },
      },
      photos: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: { photos: true, members: true },
      },
    },
  });

  const albumIds = albums.map((a) => a.id);

  const recentPhotos = albumIds.length
    ? await db.photo.findMany({
        where: { albumId: { in: albumIds } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { uploader: true, album: true },
      })
    : [];

  const albumCards = albums.map((album) => {
    const latestPhoto = album.photos[0];
    const memberList = [
      {
        id: album.owner.id,
        name: album.owner.name ?? album.owner.email,
        avatarUrl: album.owner.avatarUrl,
      },
      ...album.members
        .filter((m) => m.user.id !== album.owner.id)
        .map((m) => ({
          id: m.user.id,
          name: m.user.name ?? m.user.email,
          avatarUrl: m.user.avatarUrl,
        })),
    ].slice(0, 4);

    return {
      id: album.id,
      title: album.title,
      coverImageUrl: latestPhoto ? latestPhoto.thumbnailUrl ?? latestPhoto.mediaUrl : null,
      coverIsVideo: latestPhoto?.mediaType === "VIDEO" && !latestPhoto.thumbnailUrl,
      photoCount: album._count.photos,
      members: memberList,
      memberCount: album._count.members + 1, // +1: owner分（membersテーブルにはowner自身は入らないため）
      updatedAt: album.updatedAt,
    };
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
          マイアルバム
        </h2>
        {albumCards.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-steam-muted">
            まだアルバムがありません。作成するか、Discordに投稿してみましょう。
          </p>
        ) : (
          <div className="mt-2">
            <AlbumGrid albums={albumCards} />
          </div>
        )}
      </section>
    </main>
  );
}
