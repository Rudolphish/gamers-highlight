import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { invalidateAlbum } from "@/lib/cacheTags";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";
import { INVALID_ROLE_MESSAGE, parseMemberRole } from "@/lib/memberRole";

/** グループ詳細にもアルバム名が出るので、グループのタグも一緒に飛ばす */
async function invalidateAlbumWithGroup(albumId: string) {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { groupId: true } });
  invalidateAlbum(albumId, album?.groupId);
}

// PATCH /api/albums/:id/members/:userId … 権限変更
export async function PATCH(req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})); // { role: "EDITOR" | "VIEWER" }
  const role = parseMemberRole(body.role);
  if (!role) return NextResponse.json({ error: INVALID_ROLE_MESSAGE }, { status: 400 });

  // メンバーでない人を指定されたら404（以前は update が例外を投げて500になっていた）
  const where = { albumId_userId: { albumId: params.id, userId: params.userId } };
  if (!(await db.albumMember.findUnique({ where, select: { id: true } }))) {
    return NextResponse.json({ error: "not a member" }, { status: 404 });
  }
  const member = await db.albumMember.update({ where, data: { role } });

  await invalidateAlbumWithGroup(params.id);
  return NextResponse.json({ member });
}

// DELETE /api/albums/:id/members/:userId … メンバー削除
export async function DELETE(_req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { count } = await db.albumMember.deleteMany({
    where: { albumId: params.id, userId: params.userId },
  });
  if (count === 0) return NextResponse.json({ error: "not a member" }, { status: 404 });

  await invalidateAlbumWithGroup(params.id);
  return NextResponse.json({ ok: true });
}
