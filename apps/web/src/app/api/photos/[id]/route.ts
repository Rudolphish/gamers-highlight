import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// DELETE /api/photos/:id
// アップロード自体を取り消す用途、および動画アップロード時に
// サムネイル画像用に一時的に作られたPhotoレコードの後始末に使う。
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
  return NextResponse.json({ ok: true });
}
