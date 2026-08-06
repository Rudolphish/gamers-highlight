import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PhotoGrid } from "@/components/photo/PhotoGrid";
import { AlbumTagManager } from "@/components/discord/AlbumTagManager";
import { ShareModal } from "@/components/album/ShareModal";
import { DeleteAlbumButton } from "@/components/album/DeleteAlbumButton";

// アルバム詳細画面：写真グリッド表示、メンバー一覧、タグ管理
export default async function AlbumDetailPage({
  params,
}: {
  params: { albumId: string };
}) {
  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;

  const album = await db.album.findUnique({
    where: { id: params.albumId },
    include: {
      members: { include: { user: true } },
      owner: true,
    },
  });
  if (!album) notFound();

  const photos = await db.photo.findMany({
    where: { albumId: album.id },
    orderBy: { createdAt: "desc" },
  });

  const tags = await db.discordGameTag.findMany({
    where: { autoAlbumId: album.id },
    orderBy: { createdAt: "asc" },
  });

  const memberNames = [
    album.owner.name ?? album.owner.email ?? "オーナー",
    ...album.members.map((m) => m.user.name ?? m.user.email ?? "メンバー"),
  ];

  const isOwner = currentUser?.id === album.ownerId;

  const shareMembers = [
    {
      userId: album.owner.id,
      name: album.owner.name ?? album.owner.email,
      avatarUrl: album.owner.avatarUrl,
      role: "OWNER" as const,
      isOwner: true,
    },
    ...album.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name ?? m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      isOwner: false,
    })),
  ];

  // 招待候補：まだこのアルバムのオーナー/メンバーではない全ユーザー
  const existingIds = new Set(shareMembers.map((m) => m.userId));
  const allUsers = isOwner
    ? await db.user.findMany({ select: { id: true, name: true, email: true } })
    : [];
  const inviteCandidates = allUsers.filter((u) => !existingIds.has(u.id));

  return (
    <main className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
            {album.title}
          </h1>
          <p className="mt-1 font-mono text-xs text-steam-muted">{memberNames.join(" / ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ShareModal
            albumId={album.id}
            isOwner={isOwner}
            members={shareMembers}
            candidates={inviteCandidates}
          />
          {isOwner && <DeleteAlbumButton albumId={album.id} groupId={album.groupId} />}
        </div>
      </div>

      <div className="mt-6">
        <AlbumTagManager
          albumId={album.id}
          initialTags={tags.map((t) => ({ id: t.id, tag: t.tag, guildId: t.guildId }))}
        />
      </div>

      <div className="mt-6">
        {photos.length === 0 ? (
          <p className="font-mono text-sm text-steam-muted">
            まだ写真/動画がありません。手動アップロードするか、Discordに投稿してみましょう。
          </p>
        ) : (
          <PhotoGrid
            photos={photos.map((p) => ({
              id: p.id,
              mediaType: p.mediaType,
              mediaUrl: p.mediaUrl,
              thumbnailUrl: p.thumbnailUrl,
              durationSeconds: p.durationSeconds,
              canDelete: isOwner || p.uploaderId === currentUser?.id,
            }))}
          />
        )}
      </div>
    </main>
  );
}
