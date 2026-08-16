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

// GET /api/albums/:id/tags … このアルバムに紐付いているハッシュタグ一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const tags = await db.discordGameTag.findMany({
    where: { autoAlbumId: params.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ tags });
}

// POST /api/albums/:id/tags … タグ（別名）を追加
// body: { guildId, tag }
//
// 既に同じ(guildId, tag)が他のアルバムに紐付いている場合は「付け替え」として扱う。
// これにより「#eldenring」と「#elden_ring」のような表記ゆれを、
// 後から同じアルバムにまとめて集約できる（今回のタグ統合機能の要）。
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, actor.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const tag = String(body.tag).toLowerCase().trim();
  const guildId = String(body.guildId);

  if (!tag) {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  const album = await db.album.findUnique({ where: { id: params.id } });
  if (!album) return NextResponse.json({ error: "album not found" }, { status: 404 });

  const gameTag = await db.discordGameTag.upsert({
    where: { guildId_tag: { guildId, tag } },
    update: { autoAlbumId: params.id }, // 既存タグを付け替え（＝別アルバムからの統合）
    create: {
      guildId,
      tag,
      gameTitle: album.gameTitle ?? album.title,
      autoAlbumId: params.id,
      registeredBy: actor.id,
    },
  });

  await invalidateAlbumWithGroup(params.id);
  return NextResponse.json({ tag: gameTag }, { status: 201 });
}
