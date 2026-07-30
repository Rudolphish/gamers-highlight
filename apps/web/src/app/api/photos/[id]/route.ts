import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// DELETE /api/photos/:id
// アップロード自体を取り消す用途、および動画アップロード時に
// サムネイル画像用に一時的に作られたPhotoレコードの後始末に使う。
// 本人がアップロードしたものだけ削除できる（アルバム権限とは別に、まず投稿者本人のみ許可）。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const photo = await db.photo.findUnique({ where: { id: params.id } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (photo.uploaderId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.photo.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
