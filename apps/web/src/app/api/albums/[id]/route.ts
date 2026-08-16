import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateAlbum } from "@/lib/cacheTags";
import { hasAlbumPermission } from "@/lib/permissions";
import { cacheSteamHeaderImage } from "@/lib/albumCover";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
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
  const user = await getCurrentUser();
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

  // サムネイルに使う正しいURLを控えておく（無いと組み立てURLに落ちて空表示になる）
  if (typeof body.steamAppId === "number") {
    await cacheSteamHeaderImage(body.steamAppId);
  }

  // タイトル・カバーはアルバム詳細にもグループ詳細にも出るので両方飛ばす
  invalidateAlbum(album.id, album.groupId);

  return NextResponse.json({ album });
}

// DELETE /api/albums/:id … OWNERのみ削除可
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 削除後には辿れないので、先にグループを控える（グループ詳細のアルバム一覧を飛ばすため）
  const target = await db.album.findUnique({
    where: { id: params.id },
    select: { groupId: true },
  });

  // ハッシュタグ/チャンネルマッピングがこのアルバムをautoAlbumIdとして参照している場合、
  // 外部キー制約で削除がブロックされるため、アルバムと一緒に紐付けも削除する
  await db.$transaction([
    db.discordGameTag.deleteMany({ where: { autoAlbumId: params.id } }),
    db.discordChannelMapping.deleteMany({ where: { autoAlbumId: params.id } }),
    db.album.delete({ where: { id: params.id } }),
  ]);
  invalidateAlbum(params.id, target?.groupId);

  return NextResponse.json({ ok: true });
}
