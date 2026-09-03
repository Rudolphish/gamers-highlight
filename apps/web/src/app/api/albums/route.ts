import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { z } from "zod";

const createAlbumSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(100),
  description: z.string().trim().max(500).optional(),
  gameTitle: z.string().trim().max(100).optional(),
  groupId: z.string().trim().min(1, "groupId is required"),
});

// GET /api/albums … 自分が所有/参加しているアルバム一覧
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // **グループも一緒に返す。** アルバム名だけを並べると、別グループの同名アルバムを
  // 見分けられず振り分けを間違える（アップロード画面と未分類の振り分けで実際に起きた）。
  // 呼び出し側はこの groupId でアルバムを絞り込み、名前で選ばせない。
  const albums = await db.album.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    include: { group: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ albums });
}

// POST /api/albums … アルバム作成
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const allowed = await hasGroupPermission(parsed.data.groupId, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const album = await db.album.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      gameTitle: parsed.data.gameTitle ?? null,
      ownerId: user.id,
      groupId: parsed.data.groupId,
    },
  });

  invalidateGroup(album.groupId);

  await logActivity({
    kind: "album.created",
    targetId: album.id,
    targetName: album.title,
    groupId: album.groupId,
    actorId: user.id,
    occurredAt: album.createdAt,
  });

  return NextResponse.json({ album }, { status: 201 });
}
