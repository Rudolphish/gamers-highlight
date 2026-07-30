import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PhotoGrid } from "@/components/photo/PhotoGrid";
import { AlbumTagManager } from "@/components/discord/AlbumTagManager";

// アルバム詳細画面：写真グリッド表示、メンバー一覧、タグ管理
export default async function AlbumDetailPage({
  params,
}: {
  params: { albumId: string };
}) {
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

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        {album.title}
      </h1>
      <p className="mt-1 font-mono text-xs text-steam-muted">{memberNames.join(" / ")}</p>

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
            }))}
          />
        )}
      </div>
    </main>
  );
}
