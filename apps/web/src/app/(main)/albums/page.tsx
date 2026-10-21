import Link from "next/link";
import { Film, Inbox, Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { AlbumSearch } from "@/components/album/AlbumSearch";
import { getSteamCoverUrls } from "@/lib/albumCover";
import { coverPhotoQuery } from "@/lib/albumCoverPolicy";
import { formatRelativeTime } from "@/lib/relative-time";
import { primaryButton } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";

// アルバム一覧画面：自分のアルバム一覧＋未分類の投稿への導線
export default async function AlbumsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const albums = await db.album.findMany({
    where: {
      OR: [
        { ownerId: user.id },
        { members: { some: { userId: user.id } } },
        { group: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: true,
      group: { select: { id: true, name: true } },
      members: {
        orderBy: { invitedAt: "asc" },
        take: 4,
        include: { user: true },
      },
      // カバー候補（どの投稿を使うかは lib/albumCoverPolicy.ts で決める）
      photos: coverPhotoQuery,
      _count: {
        select: { photos: true, members: true },
      },
    },
  });

  // 組み立てURLは新しいタイトルで404になるため、appdetails由来の値を先に引く
  const steamCovers = await getSteamCoverUrls(albums.map((a) => a.steamAppId));

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

    const steamCoverUrl = album.steamAppId ? steamCovers.get(album.steamAppId) ?? null : null;

    return {
      id: album.id,
      title: album.title,
      coverImageUrl:
        steamCoverUrl ?? (latestPhoto ? latestPhoto.thumbnailUrl ?? latestPhoto.mediaUrl : null),
      coverIsVideo: !steamCoverUrl && latestPhoto?.mediaType === "VIDEO" && !latestPhoto.thumbnailUrl,
      photoCount: album._count.photos,
      members: memberList,
      memberCount: album._count.members + 1,
      updatedAt: album.updatedAt,
      // 表示はサーバーで作る（components/album/AlbumCard.tsx のコメント参照）
      updatedLabel: formatRelativeTime(album.updatedAt),
      groupName: album.group.name,
      groupId: album.group.id,
      gameTitle: album.gameTitle,
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
          className={primaryButton}
        >
          <Plus size={16} aria-hidden="true" /> 新規アルバム
        </Link>
      </div>

      {unclassifiedCount > 0 && (
        <Link
          href="/albums/unclassified"
          className="mt-4 flex items-center gap-3 rounded-xl bg-steam-surface p-3 transition hover:bg-steam-panel"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-steam-panel text-steam-blue">
            <Inbox size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-steam-text">未分類の投稿</p>
            <p className="text-sm text-steam-muted">
              まだどのアルバムにも入っていない投稿が{unclassifiedCount}件あります。タップして振り分ける
            </p>
          </div>
        </Link>
      )}

      {albumCards.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Film} title="まだアルバムがありません" description="アルバムを作るか、Discordに投稿すると自動で作られます。" />
        </div>
      ) : (
        <AlbumSearch albums={albumCards} />
      )}
    </main>
  );
}
