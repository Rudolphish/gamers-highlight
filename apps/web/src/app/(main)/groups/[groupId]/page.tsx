import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getGroupContent, getProposalHeaderImages } from "@/lib/groupData";
import { ExpandableAlbumGrid } from "@/components/album/ExpandableAlbumGrid";
import { GroupShareModal } from "@/components/group/GroupShareModal";
import { GroupNameEditor } from "@/components/group/GroupNameEditor";
import { DeleteGroupButton } from "@/components/group/DeleteGroupButton";
import { GroupGameList } from "@/components/group/GroupGameList";
import { PlayStatusSummary } from "@/components/group/PlayStatusSummary";
import { GameProposals } from "@/components/group/GameProposals";
import { NotificationChannelSetting } from "@/components/group/NotificationChannelSetting";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { getSteamCoverUrls } from "@/lib/albumCover";

// サーバーから取る上限。**ここを超えた分はグループ画面から辿れなくなる**ので、
// 数十件規模なら全部載る値にしておく（ゲーム1本につきアルバム1つ作られるため、
// 遊ぶゲームが増えるとすぐ数十件になる。実際に42件になった）。
// 画面に一度に出す件数は下のALBUM_INITIAL_VISIBLEで別に絞っている。
const ALBUM_PAGE_SIZE = 100;

// グループ画面はアルバムの下にゲームリストや提案が続くので、既定は絞って出す。
// 残りは「さらに表示」で開く（取得済みなので押しても問い合わせは発生しない）。
// 4件なのは画面幅が広いときのグリッドが4列で、ちょうど1行に収まるため。
const ALBUM_INITIAL_VISIBLE = 4;

// グループ詳細画面：名前編集、メンバー管理、配下アルバム一覧
export default async function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) notFound();

  // このページは`/groups`がmiddlewareのmatcher対象外のため、未ログインでも素通りして
  // グループ名・メンバー・ゲーム一覧まで見えてしまっていた（2026-08-10にレビューで発覚、
  // 実際に未ログインのcurlで200が返ることを確認済み）。配下のゲーム詳細ページと同じく、
  // ページ側でVIEWER権限を必須にする。
  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  // ここから先はキャッシュ済みの中身（権限は上で判定済み）。
  // 中身は「誰が見ても同じ」なのでユーザーをキーに含めない。無効化は lib/cacheTags.ts から。
  const group = await getGroupContent(params.groupId, ALBUM_PAGE_SIZE);
  if (!group) notFound();

  const isOwner = currentUser?.id === group.ownerId;
  const currentMembership = group.members.find((m) => m.userId === currentUser?.id);
  const canEditGames = isOwner || currentMembership?.role === "EDITOR";
  const likeThreshold = Math.floor((1 + group.members.length) / 2) + 1;

  // 提案のcoverUrlは、以前は固定パスの組み立てをそのまま保存していたため新しめのタイトルで404になる。
  // appdetails由来の確実なURLがキャッシュにあればそちらを優先する（古い提案の救済）。
  const proposalHeaderImages = new Map(
    (await getProposalHeaderImages(group.proposals.map((p) => p.steamAppId))).map((c) => [
      c.steamAppId,
      c.headerImage,
    ])
  );

  const proposalCards = group.proposals.map((p) => ({
    id: p.id,
    title: p.title,
    coverUrl: proposalHeaderImages.get(p.steamAppId) ?? p.coverUrl,
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

  // 組み立てURLは新しいタイトルで404になるため、appdetails由来の値を先に引く
  const steamCovers = await getSteamCoverUrls(group.albums.map((a) => a.steamAppId));

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
      // 並び替えの「新着順」で使う。updatedAtと違い、写真が増えても動かない
      createdAt: album.createdAt,
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
              <ExpandableAlbumGrid albums={albumCards} initialCount={ALBUM_INITIAL_VISIBLE} />
              {group._count.albums > albumCards.length && (
                <p className="mt-3 font-mono text-3xs text-steam-muted">
                  更新が新しい{albumCards.length}件まで表示できます（全{group._count.albums}件）。
                  並び替えもこの{albumCards.length}件の中で効きます。
                  古いアルバムは<Link href="/albums" className="text-steam-blue hover:underline">アルバム一覧</Link>から探せます。
                </p>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>

      <div className="mt-8">
        {/* プレイ中・クリア済みも含むので「気になっている」ではなくグループ全体のゲーム置き場として扱う */}
        <CollapsibleSection title="みんなのゲーム">
          <PlayStatusSummary groupId={group.id} games={gameCards} />
          <GroupGameList
            groupId={group.id}
            games={gameCards}
            canEdit={canEditGames}
            currentUserId={currentUser.id}
          />
        </CollapsibleSection>
      </div>

      <div className="mt-8">
        <GameProposals
          groupId={group.id}
          proposals={proposalCards}
          currentUserId={currentUser.id}
          likeThreshold={likeThreshold}
          canManage={canEditGames}
        />
      </div>
    </main>
  );
}
