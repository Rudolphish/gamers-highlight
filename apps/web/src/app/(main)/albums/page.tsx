import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { AlbumGrid } from "@/components/album/AlbumGrid";

// アルバム一覧画面：自分のアルバム一覧＋未分類の投稿への導線
export default async function AlbumsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

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

  const unclassifiedCount = await db.photo.count({
    where: { albumId: null, uploaderId: user.id },
  });

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
      memberCount: album._count.members + 1,
      updatedAt: album.updatedAt,
    };
  });

  return (
    <main className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
          アルバム一覧
        </h1>
        <Link
          href="/albums/new"
          className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
        >
          <Plus size={14} /> 新規アルバム
        </Link>
      </div>

      {unclassifiedCount > 0 && (
        <Link
          href="/albums/unclassified"
          className="mt-4 flex items-center gap-3 rounded-sm border border-dashed border-steam-border bg-steam-surface p-3 transition hover:border-steam-blue"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-steam-panel text-steam-blue">
            <Inbox size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-steam-text">未分類の投稿</p>
            <p className="font-mono text-[11px] text-steam-muted">
              まだどのアルバムにも入っていない投稿が{unclassifiedCount}件あります。タップして振り分ける
            </p>
          </div>
        </Link>
      )}

      {albumCards.length === 0 ? (
        <p className="mt-6 font-mono text-sm text-steam-muted">
          まだアルバムがありません。作成するか、Discordに投稿してみましょう。
        </p>
      ) : (
        <div className="mt-6">
          <AlbumGrid albums={albumCards} />
        </div>
      )}
    </main>
  );
}
