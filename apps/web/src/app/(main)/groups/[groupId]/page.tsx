import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { AlbumGrid } from "@/components/album/AlbumGrid";
import { GroupShareModal } from "@/components/group/GroupShareModal";
import { GroupNameEditor } from "@/components/group/GroupNameEditor";
import { DeleteGroupButton } from "@/components/group/DeleteGroupButton";
import { GroupGameList } from "@/components/group/GroupGameList";
import { PlayStatusSummary } from "@/components/group/PlayStatusSummary";
import { SuggestedGames } from "@/components/group/SuggestedGames";
import { GameProposals } from "@/components/group/GameProposals";
import { NotificationChannelSetting } from "@/components/group/NotificationChannelSetting";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { steamHeaderImageUrl, searchSteamByGenre } from "@/lib/steam";

// アルバム数がグループの活動量に応じて際限なく増えうるため、初期表示は最新分のみに絞る
// （継続的にスクショを投稿するアプリの性質上、他のリレーション以上に増加が速いため）
const ALBUM_PAGE_SIZE = 24;

// グループ詳細画面：名前編集、メンバー管理、配下アルバム一覧
export default async function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!currentUser) notFound();

  // このページは`/groups`がmiddlewareのmatcher対象外のため、未ログインでも素通りして
  // グループ名・メンバー・ゲーム一覧まで見えてしまっていた（2026-08-10にレビューで発覚、
  // 実際に未ログインのcurlで200が返ることを確認済み）。配下のゲーム詳細ページと同じく、
  // ページ側でVIEWER権限を必須にする。
  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  const group = await db.group.findUnique({
    where: { id: params.groupId },
    include: {
      owner: true,
      members: { include: { user: true } },
      albums: {
        orderBy: { updatedAt: "desc" },
        take: ALBUM_PAGE_SIZE,
        include: {
          owner: true,
          members: { take: 4, orderBy: { invitedAt: "asc" }, include: { user: true } },
          photos: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { photos: true, members: true } },
        },
      },
      _count: { select: { albums: true } },
      games: {
        orderBy: { createdAt: "desc" },
        include: { addedBy: true, interests: { include: { user: true } } },
      },
      proposals: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        include: { proposedBy: true, reactions: true },
      },
    },
  });
  if (!group) notFound();

  const isOwner = currentUser?.id === group.ownerId;
  const currentMembership = group.members.find((m) => m.userId === currentUser?.id);
  const canEditGames = isOwner || currentMembership?.role === "EDITOR";
  const likeThreshold = Math.floor((1 + group.members.length) / 2) + 1;

  const proposalCards = group.proposals.map((p) => ({
    id: p.id,
    title: p.title,
    coverUrl: p.coverUrl,
    proposedById: p.proposedById,
    proposedByName: p.proposedBy.name ?? p.proposedBy.email ?? "メンバー",
    reactions: p.reactions.map((r) => ({ userId: r.userId, type: r.type })),
  }));

  const gameCards = group.games.map((g) => ({
    id: g.id,
    steamAppId: g.steamAppId,
    title: g.title,
    coverUrl: g.coverUrl,
    status: g.status,
    genres: g.genres,
    addedByName: g.addedBy.name ?? g.addedBy.email ?? "メンバー",
    interestedUsers: g.interests.map((i) => ({
      id: i.userId,
      name: i.user.name ?? i.user.email ?? "メンバー",
    })),
  }));

  // サジェスト：グループの既存ゲームで一番多いジャンルから、未追加のSteam人気ゲームを提案する簡易ルールベース
  const genreCounts = new Map<string, number>();
  for (const g of group.games) {
    for (const genre of g.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }
  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let suggestions: Awaited<ReturnType<typeof searchSteamByGenre>> = [];
  if (topGenre && canEditGames) {
    const existingAppIds = new Set(group.games.map((g) => g.steamAppId));
    try {
      const candidates = await searchSteamByGenre(topGenre, 20);
      suggestions = candidates.filter((c) => !existingAppIds.has(c.appId)).slice(0, 4);
    } catch {
      suggestions = [];
    }
  }

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

    const steamCoverUrl = album.steamAppId ? steamHeaderImageUrl(album.steamAppId) : null;

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
    };
  });

  return (
    <main className="p-4 sm:p-6">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> グループ一覧に戻る
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <GroupNameEditor groupId={group.id} name={group.name} canEdit={isOwner} />
          {isOwner && (
            <div className="mt-1.5">
              <NotificationChannelSetting groupId={group.id} channelId={group.notificationChannelId} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <GroupShareModal
            groupId={group.id}
            isOwner={isOwner}
            members={shareMembers}
            candidates={inviteCandidates}
          />
          {isOwner && <DeleteGroupButton groupId={group.id} />}
        </div>
      </div>

      <div className="mt-6">
        <CollapsibleSection
          title="アルバム"
          headerAction={
            <Link
              href={`/groups/${group.id}/albums/new`}
              className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
            >
              <Plus size={14} /> 新規アルバム
            </Link>
          }
        >
          {albumCards.length === 0 ? (
            <p className="font-mono text-sm text-steam-muted">
              まだアルバムがありません。作成するか、Discordに投稿してみましょう。
            </p>
          ) : (
            <>
              <AlbumGrid albums={albumCards} />
              {group._count.albums > albumCards.length && (
                <p className="mt-3 font-mono text-[10px] text-steam-muted">
                  更新が新しい{albumCards.length}件を表示中（全{group._count.albums}件）。
                  古いアルバムは<Link href="/albums" className="text-steam-blue hover:underline">アルバム一覧</Link>から探せます。
                </p>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>

      <div className="mt-8">
        <CollapsibleSection title="気になっているゲーム">
          <PlayStatusSummary groupId={group.id} games={gameCards} />
          <GroupGameList
            groupId={group.id}
            games={gameCards}
            canEdit={canEditGames}
            currentUserId={currentUser.id}
          />
          {topGenre && (
            <SuggestedGames groupId={group.id} genre={topGenre} suggestions={suggestions} />
          )}
          <GameProposals
            groupId={group.id}
            proposals={proposalCards}
            currentUserId={currentUser.id}
            likeThreshold={likeThreshold}
            canManage={canEditGames}
          />
        </CollapsibleSection>
      </div>
    </main>
  );
}
