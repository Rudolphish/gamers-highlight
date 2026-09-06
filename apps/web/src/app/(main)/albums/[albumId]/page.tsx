import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";
import { getAlbumContent, getAlbumPhotos, getAlbumTags, getPhotoReactions } from "@/lib/albumData";
import { PhotoGrid } from "@/components/photo/PhotoGrid";
import { AlbumTagManager } from "@/components/discord/AlbumTagManager";
import { ShareModal } from "@/components/album/ShareModal";
import { DeleteAlbumButton } from "@/components/album/DeleteAlbumButton";
import { SteamCoverPicker } from "@/components/album/SteamCoverPicker";
import { AlbumTitleEditor } from "@/components/album/AlbumTitleEditor";

// アルバム詳細画面：写真グリッド表示、メンバー一覧、タグ管理
export default async function AlbumDetailPage({
  params,
}: {
  params: { albumId: string };
}) {
  const currentUser = await getCurrentUser();

  if (!currentUser) notFound();

  // グループページ・ゲーム詳細ページと同じく、ページ側でもVIEWER権限を必須にする。
  // ここが無いと、ログインさえしていればURLを知っているだけで他人のグループの
  // アルバム（写真・メンバー名）が見えてしまっていた。APIは以前から403を返していたが、
  // このページはDBを直接読むためAPIの判定を通らない（実際に200で中身が出ることを確認済み）。
  const allowed = await hasAlbumPermission(params.albumId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  // 説明はそのアルバムを見られる人なら誰でも書ける（＝グループのメンバー）。
  // このページは上のVIEWER判定を通らないと描画されないので、ここまで来た人は全員書ける。
  // 追加で権限を引き直さないのは、同じことを2回聞くことになるため。
  const canEditDescription = true;

  // ここから先はキャッシュ済みの中身（権限は上で判定済み）。
  // 中身は「誰が見ても同じ」なのでユーザーをキーに含めない。無効化は lib/cacheTags.ts から。
  const album = await getAlbumContent(params.albumId);
  if (!album) notFound();

  const [photos, tags, reactions] = await Promise.all([
    getAlbumPhotos(album.id),
    getAlbumTags(album.id),
    // **リアクションだけはキャッシュしない**（albumData.ts の getPhotoReactions を参照）。
    // 写真のキャッシュに混ぜると、1回押すたびにアルバムの写真キャッシュが飛ぶ
    getPhotoReactions(album.id, currentUser.id),
  ]);

  // ❤️を押したときに名前の一覧へ自分を足すのに使う（サーバーの値が返るまでの表示用）
  const currentUserName =
    album.owner.id === currentUser.id
      ? album.owner.name ?? album.owner.email
      : album.members.find((m) => m.user.id === currentUser.id)?.user.name ??
        album.members.find((m) => m.user.id === currentUser.id)?.user.email ??
        null;

  const memberNames = [
    album.owner.name ?? album.owner.email ?? "オーナー",
    ...album.members.map((m) => m.user.name ?? m.user.email ?? "メンバー"),
  ];

  const isOwner = currentUser?.id === album.ownerId;

  // **アルバム名を変えられるのは EDITOR 以上**（`PATCH /api/albums/:id` と同じ条件）。
  // グループの権限が配下のアルバムに与えるのは VIEWER までなので、
  // グループのメンバーというだけでは変えられない（`lib/permissions.ts`）。
  // ここは入口を出すかどうかの判断だけで、権限は毎回サーバーで見ている。
  const canRename =
    isOwner ||
    album.members.some(
      (m) => m.user.id === currentUser.id && (m.role === "EDITOR" || m.role === "OWNER")
    );

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
      <Link
        href={`/groups/${album.groupId}`}
        className="inline-flex items-center gap-1.5 font-mono text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {album.group.name}に戻る
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {canRename ? (
            <AlbumTitleEditor albumId={album.id} title={album.title} />
          ) : (
            <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
              {album.title}
            </h1>
          )}
          <p className="mt-1 font-mono text-xs text-steam-muted">{memberNames.join(" / ")}</p>
          {album.groupGame && (
            <Link
              href={`/groups/${album.groupId}/games/${album.groupGame.id}`}
              className="mt-1 inline-flex items-center gap-1 font-mono text-2xs text-steam-blue hover:underline"
            >
              <Gamepad2 size={12} /> ゲーム詳細を見る
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ShareModal
            albumId={album.id}
            isOwner={isOwner}
            members={shareMembers}
            candidates={inviteCandidates}
          />
          {isOwner && (
            <SteamCoverPicker
              albumId={album.id}
              groupId={album.groupId}
              initialQuery={album.gameTitle ?? album.title}
              hasSteamCover={album.steamAppId !== null}
              linkedGameId={album.groupGame?.id}
            />
          )}
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
            currentUserName={currentUserName}
            canEditDescription={canEditDescription}
            photos={photos.map((p) => ({
              id: p.id,
              mediaType: p.mediaType,
              mediaUrl: p.mediaUrl,
              thumbnailUrl: p.thumbnailUrl,
              durationSeconds: p.durationSeconds,
              canDelete: isOwner || p.uploaderId === currentUser?.id,
              capturedAt: p.capturedAt,
              gameTitle: p.gameTitle,
              uploaderName: p.uploaderName,
              albumTitle: album.title,
              reaction: {
                count: reactions.countByPhotoId.get(p.id) ?? 0,
                reacted: reactions.reactedPhotoIds.has(p.id),
                names: reactions.namesByPhotoId.get(p.id) ?? [],
              },
              description: {
                text: p.description,
                editorName: p.descriptionEditorName,
                updatedAt: p.descriptionUpdatedAt,
              },
            }))}
          />
        )}
      </div>
    </main>
  );
}
