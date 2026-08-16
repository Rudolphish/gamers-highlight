import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// PATCH /api/albums/:id/members/:userId … 権限変更
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json(); // { role: "EDITOR" | "VIEWER" }

  const member = await db.albumMember.update({
    where: { albumId_userId: { albumId: params.id, userId: params.userId } },
    data: { role: body.role },
  });

  return NextResponse.json({ member });
}

// DELETE /api/albums/:id/members/:userId … メンバー削除
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.albumMember.delete({
    where: { albumId_userId: { albumId: params.id, userId: params.userId } },
  });

  return NextResponse.json({ ok: true });
}
