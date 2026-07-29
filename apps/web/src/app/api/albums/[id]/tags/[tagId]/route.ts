import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// DELETE /api/albums/:id/tags/:tagId … タグ（別名）の削除
// 削除後にそのタグで投稿されると、次はまた「未分類」or 新規アルバム自動生成の対象になる。
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; tagId: string } }
) {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const tag = await db.discordGameTag.findUnique({ where: { id: params.tagId } });
  if (!tag || tag.autoAlbumId !== params.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.discordGameTag.delete({ where: { id: params.tagId } });
  return NextResponse.json({ ok: true });
}
