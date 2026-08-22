import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";

// PATCH /api/groups/:id/members/:userId … 権限変更
// audit-activity-log: 意図的に記録しない（役割の変更と、メンバーの削除。
// 加入〈member.joined〉だけを記録する。週次まとめに『誰が抜けた』『誰が降格した』が
// 並ぶと、身内で使う道具としては角が立つ。必要になったら kind を足す）
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json(); // { role: "EDITOR" | "VIEWER" }

  const member = await db.groupMember.update({
    where: { groupId_userId: { groupId: params.id, userId: params.userId } },
    data: { role: body.role },
  });

  invalidateGroup(params.id);
  return NextResponse.json({ member });
}

// DELETE /api/groups/:id/members/:userId … メンバー削除
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; userId: string } }
) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.groupMember.delete({
    where: { groupId_userId: { groupId: params.id, userId: params.userId } },
  });

  invalidateGroup(params.id);
  return NextResponse.json({ ok: true });
}
