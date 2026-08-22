import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { z } from "zod";

const updateGameSchema = z.object({
  status: z.enum(["WISHLIST", "PLAYING", "BACKLOG", "COMPLETED"]),
});

// PATCH /api/groups/:id/games/:gameId … ステータス変更
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = updateGameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // **変更前のステータスを先に読む。** 「今週クリアしたゲーム」を出すには from→to が要るが、
  // update は変更後しか返さない。GroupGame.updatedAt では代用できない——
  // 日次cronの check-wishlist-prices が lastPriceCheckedAt を毎日書くため、
  // ウィッシュリストのゲームは updatedAt が毎日動く（docs/activity-log.md §1）。
  //
  // ステータス変更は頻度が低い操作なので、ここで1往復増えることは許容する。
  const before = await db.groupGame.findUnique({
    where: { id: params.gameId, groupId: params.id },
    select: { status: true },
  });

  const game = await db.groupGame.update({
    where: { id: params.gameId, groupId: params.id },
    data: { status: parsed.data.status },
    include: { addedBy: true },
  });

  invalidateGroup(params.id);

  // 同じステータスで保存し直したときは記録しない（「今週クリアした」が空振りするため）
  if (before && before.status !== game.status) {
    await logActivity({
      kind: "game.status_changed",
      targetId: game.id,
      targetName: game.title,
      groupId: params.id,
      actorId: user.id,
      detail: { from: before.status, to: game.status },
    });
  }

  return NextResponse.json({ game });
}

// DELETE /api/groups/:id/games/:gameId … リストから削除
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 消した後は名前を引けないので先に控える（ログにIDだけ残しても画面に出せない）
  const target = await db.groupGame.findUnique({
    where: { id: params.gameId, groupId: params.id },
    select: { title: true },
  });

  await db.groupGame.delete({
    where: { id: params.gameId, groupId: params.id },
  });

  invalidateGroup(params.id);

  await logActivity({
    kind: "game.removed",
    targetId: params.gameId,
    targetName: target?.title ?? null,
    groupId: params.id,
    actorId: user.id,
  });

  return NextResponse.json({ ok: true });
}
