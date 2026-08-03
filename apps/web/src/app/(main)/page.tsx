import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { AlbumGrid } from "@/components/album/AlbumGrid";

// ホーム/タイムライン：自分と共有されたアルバムの一覧
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null; // middlewareで弾かれるはずなのでここには来ない想定
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  if (!user) return null;

  const albums = await db.album.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
        マイアルバム
      </h1>
      {albums.length === 0 ? (
        <p className="mt-4 font-mono text-sm text-steam-muted">
          まだアルバムがありません。作成するか、Discordに投稿してみましょう。
        </p>
      ) : (
        <div className="mt-4">
          <AlbumGrid albums={albums} />
        </div>
      )}
    </main>
  );
}
