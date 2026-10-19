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
import { GroupGamesSection } from "@/components/group/GroupGamesSection";
import { PlayStatusSummary } from "@/components/group/PlayStatusSummary";
import { GameProposals } from "@/components/group/GameProposals";
import { NotificationSettings } from "@/components/group/NotificationSettings";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { getSteamCoverUrls } from "@/lib/albumCover";
import { getGroupPlayTotals, getPlayLogMinParticipants, getUnknownPlays } from "@/lib/playLog";
import { PlayTotalBanner } from "@/components/group/PlayTotalBanner";
import { getRecentActivity } from "@/lib/activityFeed";
import { RecentActivity } from "@/components/group/RecentActivity";
import { isAdminEmail } from "@/lib/admin";
import { PlayLogMinParticipantsSetting } from "@/components/group/PlayLogMinParticipantsSetting";
import { UnknownPlays } from "@/components/group/UnknownPlays";

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
  // プレイ記録の最少人数は管理者だけが見て変えられる（テスト用の切り替え）。キャッシュの外で毎回読む
  const isAdmin = isAdminEmail(currentUser.email);
  const playLogMin = isAdmin ? await getPlayLogMinParticipants(group.id) : null;
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
    rank: p.rank,
    // **数値（エポックミリ秒）で渡す。** この値は `getGroupContent` の `unstable_cache` を
    // 通って来るので、キャッシュヒットの回は `Date` ではなくISO文字列で返る
    // （`CLAUDE.md` の「unstable_cache は Date を文字列にして返す」）。
    // `new Date(x)` はどちらでも通るため、ここで数値に揃えてしまう。
    createdAt: new Date(p.createdAt).getTime(),
    reactions: p.reactions.map((r) => ({ userId: r.userId, type: r.type })),
  }));

  // グループで遊んだ時間（帯とゲーム一覧）。**キャッシュに載せず毎回読む**（docs/play-log.md §13）。
  // 取れなくてもページは出す（帯と時間が出ないだけ）
  // 「最近の動き」（docs/play-log.md §11 の段階2）も同じく毎回読む。帯と並べて同時に引き、待ち時間を足さない
  const [playTotals, recentDays] = await Promise.all([
    getGroupPlayTotals(group.id).catch((e) => {
      console.error("[group] プレイ時間の取得に失敗", e);
      return null;
    }),
    getRecentActivity(group.id).catch((e) => {
      console.error("[group] 最近の動きの取得に失敗", e);
      return [];
    }),
  ]);

  const gameCards = group.games.map((g) => ({
    id: g.id,
    steamAppId: g.steamAppId,
    title: g.title,
    coverUrl: g.coverUrl,
    status: g.status,
    genres: g.genres,
    addedByName: g.addedBy.name ?? g.addedBy.email ?? "メンバー",
    playMs: playTotals?.byGame[g.id] ?? 0,
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

  // ゲームが分からなかったプレイ記録（docs/play-log.md）。**キャッシュには載せない**——
  // Botのスナップショットで増えるのに、そちらから無効化する経路を作っていないため。
  // 読めなくてもページは落とさず、区画を出さないだけにする
  const unknownPlays = await getUnknownPlays(group.id).catch((e) => {
    console.error("[group] unknown plays failed", e);
    return [];
  });

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
      // 並び替えの「新着順」で使う。**アルバムが作られた時刻**なので、投稿が増えても動かない
      // （updatedAt の方は投稿で動く。以前ここには逆のことが書いてあった——実装では
      //  写真を作ってもアルバムの行を触らないので updatedAt は動いておらず、
      //  「投稿したのに更新順で上に来ない」の原因だった。lib/albumTouch.ts 参照）
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
              <NotificationSettings
                groupId={group.id}
                targets={group.notificationTargets}
                legacyChannelId={group.notificationChannelId}
              />
            </div>
          )}
          {playLogMin !== null && (
            <div className="mt-1.5">
              <PlayLogMinParticipantsSetting groupId={group.id} initial={playLogMin} />
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

      {/* 記録が1件も無いグループでは出さない（これから使うグループで空の大きな枠が出ないように） */}
      {playTotals && playTotals.totalMs > 0 && (
        <PlayTotalBanner
          groupId={group.id}
          totalMs={playTotals.totalMs}
          gameCount={playTotals.gameCount}
          topGame={(() => {
            const g = group.games.find((x) => x.id === playTotals.topGameId);
            return g ? { id: g.id, title: g.title } : null;
          })()}
          lastPlayedAt={playTotals.lastPlayedAt}
        />
      )}

      {recentDays.length > 0 && <RecentActivity groupId={group.id} days={recentDays} />}
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
        <GroupGamesSection groupId={group.id} games={gameCards} canEdit={canEditGames} currentUserId={currentUser.id}>
          {unknownPlays.length > 0 && (
            <UnknownPlays
              groupId={group.id}
              plays={unknownPlays}
              games={gameCards.map((g) => ({ id: g.id, title: g.title }))}
            />
          )}
          <PlayStatusSummary groupId={group.id} games={gameCards} />
        </GroupGamesSection>
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
