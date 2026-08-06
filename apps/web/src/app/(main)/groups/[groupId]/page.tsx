import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { AlbumGrid } from "@/components/album/AlbumGrid";
import { GroupShareModal } from "@/components/group/GroupShareModal";
import { GroupNameEditor } from "@/components/group/GroupNameEditor";

// グループ詳細画面：名前編集、メンバー管理、配下アルバム一覧
export default async function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;

  const group = await db.group.findUnique({
    where: { id: params.groupId },
    include: {
      owner: true,
      members: { include: { user: true } },
      albums: {
        orderBy: { updatedAt: "desc" },
        include: {
          owner: true,
          members: { take: 4, orderBy: { invitedAt: "asc" }, include: { user: true } },
          photos: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { photos: true, members: true } },
        },
      },
    },
  });
  if (!group) notFound();

  const isOwner = currentUser?.id === group.ownerId;

  const shareMembers = [
    {
      userId: group.owner.id,
      name: group.owner.name ?? group.owner.email,
      avatarUrl: group.owner.avatarUrl,
      role: "OWNER" as const,
      isOwner: true,
    },
    ...group.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name ?? m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      isOwner: false,
    })),
  ];

  // 招待候補：まだこのグループのオーナー/メンバーではない全ユーザー
  const existingIds = new Set(shareMembers.map((m) => m.userId));
  const allUsers = isOwner
    ? await db.user.findMany({ select: { id: true, name: true, email: true } })
    : [];
  const inviteCandidates = allUsers.filter((u) => !existingIds.has(u.id));

  const albumCards = group.albums.map((album) => {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <GroupNameEditor groupId={group.id} name={group.name} canEdit={isOwner} />
        <GroupShareModal
          groupId={group.id}
          isOwner={isOwner}
          members={shareMembers}
          candidates={inviteCandidates}
        />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-steam-muted">
          アルバム
        </h2>
        <Link
          href={`/groups/${group.id}/albums/new`}
          className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
        >
          <Plus size={14} /> 新規アルバム
        </Link>
      </div>

      {albumCards.length === 0 ? (
        <p className="mt-4 font-mono text-sm text-steam-muted">
          まだアルバムがありません。作成するか、Discordに投稿してみましょう。
        </p>
      ) : (
        <div className="mt-4">
          <AlbumGrid albums={albumCards} />
        </div>
      )}
    </main>
  );
}
