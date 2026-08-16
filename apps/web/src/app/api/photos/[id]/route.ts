import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateAlbumPhotos } from "@/lib/cacheTags";
import { hasAlbumPermission } from "@/lib/permissions";
import { deleteStoredObjects } from "@/lib/storage";
import { isAdminEmail } from "@/lib/admin";

// DELETE /api/photos/:id
// アップロード自体を取り消す用途に使う。レコードとあわせてストレージの実体も消す。
// 投稿者本人、またはそのアルバムのOWNERが削除できる
// （未分類=albumIdなしの写真は投稿者本人のみ）。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const photo = await db.photo.findUnique({ where: { id: params.id } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isUploader = photo.uploaderId === user.id;
  const isAlbumOwner = photo.albumId
    ? await hasAlbumPermission(photo.albumId, user.id, "OWNER")
    : false;
  // 管理者は/adminのメディア一覧から横断的に消せる。容量が逼迫したときに
  // 誰の投稿かに関わらず整理できないと、管理画面の意味がないため。
  const isAdmin = isAdminEmail(session?.user?.email);
  if (!isUploader && !isAlbumOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.photo.delete({ where: { id: params.id } });

  // DBから消した後にストレージの実体も消す（この順序なので、消し漏らしても
  // 「消えたはずのものが見える」状態にはならない）。
  //
  // ただし他のレコードがまだ参照しているURLは残す。動画のthumbnailUrlには
  // 別の写真のmediaUrlを指定できるため、消してしまうとその写真が見えなくなる。
  const urls = [photo.mediaUrl, photo.thumbnailUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  const stillReferenced = new Set(
    (
      await db.photo.findMany({
        where: { OR: [{ mediaUrl: { in: urls } }, { thumbnailUrl: { in: urls } }] },
        select: { mediaUrl: true, thumbnailUrl: true },
      })
    ).flatMap((p) => [p.mediaUrl, p.thumbnailUrl])
  );

  await deleteStoredObjects(urls.filter((u) => !stillReferenced.has(u)));

  if (photo.albumId) {
    const album = await db.album.findUnique({
      where: { id: photo.albumId },
      select: { groupId: true },
    });
    invalidateAlbumPhotos(photo.albumId, album?.groupId);
  }

  return NextResponse.json({ ok: true });
}
