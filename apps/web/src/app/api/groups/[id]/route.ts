import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const group = await db.group.findUnique({
    where: { id: params.id },
    include: {
      members: { include: { user: true } },
      albums: {
        orderBy: { updatedAt: "desc" },
        include: {
          owner: true,
          members: { take: 4, orderBy: { invitedAt: "asc" }, include: { user: true } },
          photos: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { photos: true, members: true } },
        },
      },
    },
  });
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ group });
}

// PATCH /api/groups/:id … 名前変更はOWNER/EDITOR、通知先チャンネルの変更はOWNERのみ
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: { name?: string; notificationChannelId?: string | null } = {};

  if (body.name !== undefined) {
    const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    data.name = body.name;
  }

  if (body.notificationChannelId !== undefined) {
    const isOwner = await hasGroupPermission(params.id, user.id, "OWNER");
    if (!isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const trimmed = typeof body.notificationChannelId === "string" ? body.notificationChannelId.trim() : "";
    if (trimmed && !/^\d{15,25}$/.test(trimmed)) {
      return NextResponse.json({ error: "notificationChannelId must be a Discord snowflake ID" }, { status: 400 });
    }
    data.notificationChannelId = trimmed || null;
  }

  const group = await db.group.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ group });
}

// DELETE /api/groups/:id … OWNERのみ削除可。配下にアルバムが残っている場合はブロックする
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const albumCount = await db.album.count({ where: { groupId: params.id } });
  if (albumCount > 0) {
    return NextResponse.json(
      { error: "group has albums", albumCount },
      { status: 400 }
    );
  }

  await db.group.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
