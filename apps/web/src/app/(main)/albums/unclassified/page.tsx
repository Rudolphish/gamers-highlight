import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { getAssignTargets } from "@/lib/assignTargets";
import { UnclassifiedPhotoManager } from "@/components/photo/UnclassifiedPhotoManager";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

// 未分類（albumIdなし）の自分の投稿を一覧表示し、既存アルバムへ追加 or
// 新規アルバムを作ってそちらへ移動できるようにする画面。
export default async function UnclassifiedPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const photos = await db.photo.findMany({
    where: { albumId: null, uploaderId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const { albums, groups } = await getAssignTargets(user.id);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
        未分類の投稿
      </h1>
      <p className="mt-1 text-xs text-steam-muted">
        投稿を選んで、既存のアルバムに追加するか新しいアルバムを作って移動できます
      </p>

      {photos.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Inbox} title="未分類の投稿はありません" description="どのアルバムにも入っていない投稿があると、ここで振り分けられます。" />
        </div>
      ) : (
        <div className="mt-6">
          <UnclassifiedPhotoManager
            photos={photos.map((p) => ({
              id: p.id,
              mediaType: p.mediaType,
              mediaUrl: p.mediaUrl,
              thumbnailUrl: p.thumbnailUrl,
              durationSeconds: p.durationSeconds,
            }))}
            albums={albums}
            groups={groups}
          />
        </div>
      )}
    </main>
  );
}
