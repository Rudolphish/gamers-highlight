import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";
import { deleteStoredObjects } from "@/lib/storage";

// DELETE /api/photos/:id
// アップロード自体を取り消す用途に使う。レコードとあわせてストレージの実体も消す。
// 投稿者本人、またはそのアルバムのOWNERが削除できる
// （未分類=albumIdなしの写真は投稿者本人のみ）。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const photo = await db.photo.findUnique({ where: { id: params.id } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isUploader = photo.uploaderId === user.id;
  const isAlbumOwner = photo.albumId
    ? await hasAlbumPermission(photo.albumId, user.id, "OWNER")
    : false;
  if (!isUploader && !isAlbumOwner) {
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

  return NextResponse.json({ ok: true });
}
