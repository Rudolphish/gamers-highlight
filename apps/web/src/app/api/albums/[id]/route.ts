import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const album = await db.album.findUnique({
    where: { id: params.id },
    include: { members: true },
  });
  if (!album) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ album });
}

// PATCH /api/albums/:id … OWNER/EDITORのみ更新可
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  if (
    body.steamAppId !== undefined &&
    body.steamAppId !== null &&
    typeof body.steamAppId !== "number"
  ) {
    return NextResponse.json({ error: "invalid steamAppId" }, { status: 400 });
  }

  const album = await db.album.update({
    where: { id: params.id },
    data: {
      title: body.title,
      description: body.description,
      steamAppId: body.steamAppId,
    },
  });

  return NextResponse.json({ album });
}

// DELETE /api/albums/:id … OWNERのみ削除可
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // ハッシュタグ/チャンネルマッピングがこのアルバムをautoAlbumIdとして参照している場合、
  // 外部キー制約で削除がブロックされるため、アルバムと一緒に紐付けも削除する
  await db.$transaction([
    db.discordGameTag.deleteMany({ where: { autoAlbumId: params.id } }),
    db.discordChannelMapping.deleteMany({ where: { autoAlbumId: params.id } }),
    db.album.delete({ where: { id: params.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
