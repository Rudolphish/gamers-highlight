import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { z } from "zod";

const addGameSchema = z.object({
  steamAppId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().trim().url().optional(),
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

// POST /api/groups/:id/games … ゲームをグループのリストに追加（デフォルトWISHLIST）
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

  const existing = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: params.id, steamAppId: parsed.data.steamAppId } },
  });
  if (existing) {
    return NextResponse.json({ error: "このゲームは既にリストに追加されています" }, { status: 409 });
  }

  const game = await db.groupGame.create({
    data: {
      groupId: params.id,
      steamAppId: parsed.data.steamAppId,
      title: parsed.data.title,
      coverUrl: parsed.data.coverUrl,
      addedById: user.id,
    },
    include: { addedBy: true },
  });

  return NextResponse.json({ game }, { status: 201 });
}
