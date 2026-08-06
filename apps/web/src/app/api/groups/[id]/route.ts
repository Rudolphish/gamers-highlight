import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
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

// PATCH /api/groups/:id … OWNER/EDITORのみ更新可（名前変更）
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const group = await db.group.update({
    where: { id: params.id },
    data: { name: body.name },
  });

  return NextResponse.json({ group });
}

// DELETE /api/groups/:id … OWNERのみ削除可。配下にアルバムが残っている場合はブロックする
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
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
