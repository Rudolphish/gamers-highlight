import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getOrFetchExternalGameData } from "@/lib/externalGameCache";
import { z } from "zod";

const addGameSchema = z.object({
  steamAppId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().trim().url().optional(),
  albumId: z.string().trim().min(1).optional(),
});

// GET /api/groups/:id/games … グループが共有しているゲームリスト一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const games = await db.groupGame.findMany({
    where: { groupId: params.id },
    include: { addedBy: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ games });
}

// POST /api/groups/:id/games … ゲームをグループのリストに追加（デフォルトWISHLIST）。
// albumIdを渡すと、そのアルバムと紐付ける（アルバム側のSteam連携から呼ばれる想定）。
// 既に同じゲームがリストにある場合、albumId無しなら409、albumId付きならそのアルバムと紐付け直す（冪等）。
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = addGameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { albumId } = parsed.data;

  if (albumId) {
    const album = await db.album.findUnique({ where: { id: albumId }, select: { groupId: true } });
    if (!album || album.groupId !== params.id) {
      return NextResponse.json({ error: "invalid album" }, { status: 400 });
    }

    const albumLinked = await db.groupGame.findUnique({ where: { albumId } });
    if (albumLinked && albumLinked.steamAppId !== parsed.data.steamAppId) {
      return NextResponse.json({ error: "このアルバムは既に別のゲームと紐付いています" }, { status: 409 });
    }
  }

  const existing = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: params.id, steamAppId: parsed.data.steamAppId } },
  });

  if (existing) {
    if (!albumId) {
      return NextResponse.json({ error: "このゲームは既にリストに追加されています" }, { status: 409 });
    }
    const updated = await db.groupGame.update({
      where: { id: existing.id },
      data: { albumId },
      include: { addedBy: true },
    });
    return NextResponse.json({ game: updated });
  }

  const { headerImage, ...external } = await getOrFetchExternalGameData(
    parsed.data.steamAppId,
    parsed.data.title
  );

  const game = await db.groupGame.create({
    data: {
      groupId: params.id,
      steamAppId: parsed.data.steamAppId,
      title: parsed.data.title,
      // クライアントが送ってくるcoverUrlは固定パスの組み立てで、新しめのタイトルだと404になる。
      // appdetailsが返す正しいURLが取れたならそちらを優先する
      coverUrl: headerImage ?? parsed.data.coverUrl,
      albumId,
      ...external,
      addedById: user.id,
    },
    include: { addedBy: true },
  });

  return NextResponse.json({ game }, { status: 201 });
}
