import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { invalidateAlbum } from "@/lib/cacheTags";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

/** グループ詳細にもアルバム名が出るので、グループのタグも一緒に飛ばす */
async function invalidateAlbumWithGroup(albumId: string) {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { groupId: true } });
  invalidateAlbum(albumId, album?.groupId);
}

// POST /api/albums/:id/members … メンバー招待（権限指定）
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json(); // { email: string, role: "EDITOR" | "VIEWER" }
  const invitee = await db.user.findUnique({ where: { email: body.email } });
  if (!invitee) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const member = await db.albumMember.upsert({
    where: { albumId_userId: { albumId: params.id, userId: invitee.id } },
    update: { role: body.role },
    create: { albumId: params.id, userId: invitee.id, role: body.role },
  });

  await invalidateAlbumWithGroup(params.id);
  return NextResponse.json({ member }, { status: 201 });
}
