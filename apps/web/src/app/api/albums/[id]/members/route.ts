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

// POST /api/albums/:id/members … メンバー招待（権限指定）
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})); // { email: string, role: "EDITOR" | "VIEWER" }
  const role = parseMemberRole(body.role);
  if (!role) return NextResponse.json({ error: INVALID_ROLE_MESSAGE }, { status: 400 });
  // email が無い・文字列でないと findUnique が例外を投げて500になる（role と同じ形の穴）
  if (typeof body.email !== "string" || body.email.trim() === "") {
    return NextResponse.json({ error: "email を指定してください" }, { status: 400 });
  }
  const invitee = await db.user.findUnique({ where: { email: body.email } });
  if (!invitee) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const member = await db.albumMember.upsert({
    where: { albumId_userId: { albumId: params.id, userId: invitee.id } },
    update: { role },
    create: { albumId: params.id, userId: invitee.id, role },
  });

  await invalidateAlbumWithGroup(params.id);
  return NextResponse.json({ member }, { status: 201 });
}
