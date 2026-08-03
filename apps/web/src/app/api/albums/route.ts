import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createAlbumSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(100),
  description: z.string().trim().max(500).optional(),
  gameTitle: z.string().trim().max(100).optional(),
});

// GET /api/albums … 自分が所有/参加しているアルバム一覧
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const albums = await db.album.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ albums });
}

// POST /api/albums … アルバム作成
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const album = await db.album.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      gameTitle: parsed.data.gameTitle ?? null,
      ownerId: user.id,
    },
  });

  return NextResponse.json({ album }, { status: 201 });
}
