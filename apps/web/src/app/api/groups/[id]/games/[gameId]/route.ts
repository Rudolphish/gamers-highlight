import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { z } from "zod";

const updateGameSchema = z.object({
  status: z.enum(["WISHLIST", "PLAYING", "BACKLOG", "COMPLETED"]),
});

// PATCH /api/groups/:id/games/:gameId … ステータス変更
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = updateGameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const game = await db.groupGame.update({
    where: { id: params.gameId, groupId: params.id },
    data: { status: parsed.data.status },
    include: { addedBy: true },
  });

  return NextResponse.json({ game });
}

// DELETE /api/groups/:id/games/:gameId … リストから削除
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.groupGame.delete({
    where: { id: params.gameId, groupId: params.id },
  });

  return NextResponse.json({ ok: true });
}
