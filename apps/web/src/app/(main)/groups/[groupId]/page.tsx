import { notFound } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowLeft, Film, Plus, Settings, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getGroupContent, getProposalHeaderImages } from "@/lib/groupData";
import { ExpandableAlbumGrid } from "@/components/album/ExpandableAlbumGrid";
import { GroupShareModal } from "@/components/group/GroupShareModal";
import { GroupNameEditor } from "@/components/group/GroupNameEditor";
import { GroupGamesSection } from "@/components/group/GroupGamesSection";
import { PlayStatusSummary } from "@/components/group/PlayStatusSummary";
import { GameProposals } from "@/components/group/GameProposals";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { getSteamCoverUrls } from "@/lib/albumCover";
import { getGroupPlayTotals, getUnknownPlays } from "@/lib/playLog";
import { PlayTotalBanner } from "@/components/group/PlayTotalBanner";
import { getRecentActivity } from "@/lib/activityFeed";
import { RecentActivity } from "@/components/group/RecentActivity";
import { isAdminEmail } from "@/lib/admin";
import { formatRelativeTime } from "@/lib/relative-time";
import { UnknownPlays } from "@/components/group/UnknownPlays";
import { GroupSections } from "@/components/group/GroupSections";
import { MemberFaces } from "@/components/group/MemberFaces";
import { addButton, iconButton, primaryButton } from "@/components/ui/buttonStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { agreeThreshold, requiredPurchasers } from "@/lib/proposalPromotion";

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
export default async function GroupDetailPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
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
  // 歯車（グループの設定）はオーナーと管理者にだけ出す。設定画面の中身がその2人向けしか無いため
  // （通知・削除はオーナー、プレイ記録の最少人数は管理者。判定は設定画面でも行う）
  const canOpenSettings = isOwner || isAdminEmail(currentUser.email);
  const currentMembership = group.members.find((m) => m.userId === currentUser?.id);
  const canEditGames = isOwner || currentMembership?.role === "EDITOR";
  const likeThreshold = agreeThreshold(group.ownerId, group.members.map((m) => m.userId));

  // 提案のcoverUrlは、以前は固定パスの組み立てをそのまま保存していたため新しめのタイトルで404になる。
  // appdetails由来の確実なURLがキャッシュにあればそちらを優先する（古い提案の救済）。
  const proposalHeaderImages = new Map(
    (await getProposalHeaderImages(group.proposals.map((p) => p.steamAppId))).map((c) => [
      c.steamAppId,
      c.headerImage,
    ])
  );

  const proposalCards = group.proposals.filter((p) => p.status === "PENDING").map((p) => ({
    id: p.id,
    steamAppId: p.steamAppId,
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

  // 「みんなでやりたい」（lib/proposalPromotion.ts）。買う必要があるのは「やりたい」を押した人のうち、今もグループにいる人
  const memberNames = new Map([
    [group.owner.id, group.owner.name ?? group.owner.email ?? "メンバー"],
    ...group.members.map((m) => [m.user.id, m.user.name ?? m.user.email ?? "メンバー"] as const),
  ]);
  const memberIds = new Set(memberNames.keys());
  const agreedCards = group.proposals
    .filter((p) => p.status === "AGREED")
    .map((p) => {
      const bought = new Set(p.purchases.map((x) => x.userId));
      return {
        id: p.id,
        steamAppId: p.steamAppId,
        title: p.title,
        coverUrl: proposalHeaderImages.get(p.steamAppId) ?? p.coverUrl,
        // createdAt と同じく、キャッシュヒットの回は文字列で来るので数値に揃える
        agreedAt: p.agreedAt ? new Date(p.agreedAt).getTime() : 0,
        people: requiredPurchasers(p.reactions, memberIds).map((userId) => ({
          userId,
          name: memberNames.get(userId) ?? "メンバー",
          purchased: bought.has(userId),
        })),
      };
    });

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
      // 表示はサーバーで作る（components/album/AlbumCard.tsx のコメント参照）
      updatedLabel: formatRelativeTime(album.updatedAt),
      // 並び替えの「新着順」で使う。**アルバムが作られた時刻**なので、投稿が増えても動かない
      // （updatedAt の方は投稿で動く。以前ここには逆のことが書いてあった——実装では
      //  写真を作ってもアルバムの行を触らないので updatedAt は動いておらず、
      //  「投稿したのに更新順で上に来ない」の原因だった。lib/albumTouch.ts 参照）
      createdAt: album.createdAt,
    };
  });

  // 帯と「最近の動き」は単独で置かれる前提で上に余白を持っている（ホーム画面でも使う）。ここでは並びの間隔を gap で取り、
  // 部品の上の余白は打ち消す。打ち消さないと、PCの2列で右の列の見出しだけが左の列より下にずれる
  const overview = (
    <div className="flex flex-col gap-6 [&>*]:mt-0">
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
      {recentDays.length > 0 ? (
        <RecentActivity days={recentDays} calendarHref={`/groups/${group.id}/activity`} />
      ) : (
        !(playTotals && playTotals.totalMs > 0) && (
          <EmptyState icon={Activity} title="まだ動きはありません" description="写真を投稿したり、みんなでゲームを遊んだりすると、ここに出ます。" />
        )
      )}
    </div>
  );

  const albums = (
    <CollapsibleSection
      title="アルバム"
      headerAction={
        <Link href={`/groups/${group.id}/albums/new`} className={addButton}>
          <Plus size={16} aria-hidden="true" /> 新規アルバム
        </Link>
      }
    >
      {albumCards.length === 0 ? (
        <EmptyState icon={Film} title="まだアルバムがありません" description="アルバムを作るか、Discordに投稿すると自動で作られます。" />
      ) : (
        <>
          <ExpandableAlbumGrid albums={albumCards} initialCount={ALBUM_INITIAL_VISIBLE} />
          {group._count.albums > albumCards.length && (
            <p className="mt-3 text-3xs text-steam-muted">
              更新が新しい{albumCards.length}件まで表示できます（全{group._count.albums}件）。
              並び替えもこの{albumCards.length}件の中で効きます。
              古いアルバムは<Link href="/albums" className="text-steam-blue hover:underline">アルバム一覧</Link>から探せます。
            </p>
          )}
        </>
      )}
    </CollapsibleSection>
  );

  // プレイ中・クリア済みも含むので「プレイ予定」だけではなくグループ全体のゲーム置き場として扱う
  const games = (
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
  );

  const wishlist = (
    <GameProposals
      groupId={group.id}
      proposals={proposalCards}
      agreed={agreedCards}
      currentUserId={currentUser.id}
      likeThreshold={likeThreshold}
      canManage={canEditGames}
      isOwner={isOwner}
    />
  );

  return (
    <main className="p-4 sm:p-6">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1.5 text-sm text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={16} aria-hidden="true" /> グループ一覧に戻る
      </Link>

      {/* 見出し: 名前・顔ぶれ・よく使う操作。めったに触らない設定（通知・削除など）は歯車の先へ移した */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <GroupNameEditor groupId={group.id} name={group.name} canEdit={isOwner} />
        <MemberFaces members={shareMembers.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl ?? null }))} />
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Link href={`/upload?group=${group.id}`} className={`${primaryButton} flex-1 sm:flex-none`}>
            <Upload size={16} aria-hidden="true" /> 写真を投稿
          </Link>
          <GroupShareModal
            groupId={group.id}
            isOwner={isOwner}
            members={shareMembers}
            candidates={inviteCandidates}
          />
          {canOpenSettings && (
            <Link href={`/groups/${group.id}/settings`} aria-label="グループの設定" title="グループの設定" className={iconButton}>
              <Settings size={18} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      <GroupSections overview={overview} albums={albums} games={games} wishlist={wishlist} />
    </main>
  );
}
