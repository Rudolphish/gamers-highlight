import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { INVALID_ROLE_MESSAGE, parseMemberRole } from "@/lib/memberRole";

// PATCH /api/groups/:id/members/:userId … 権限変更
// audit-activity-log: 意図的に記録しない（役割の変更と、メンバーの削除。
// 加入〈member.joined〉だけを記録する。週次まとめに『誰が抜けた』『誰が降格した』が
// 並ぶと、身内で使う道具としては角が立つ。必要になったら kind を足す）
export async function PATCH(req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})); // { role: "EDITOR" | "VIEWER" }
  const role = parseMemberRole(body.role);
  if (!role) return NextResponse.json({ error: INVALID_ROLE_MESSAGE }, { status: 400 });

  // メンバーでない人を指定されたら404（以前は update が例外を投げて500になっていた）
  const where = { groupId_userId: { groupId: params.id, userId: params.userId } };
  if (!(await db.groupMember.findUnique({ where, select: { id: true } }))) {
    return NextResponse.json({ error: "not a member" }, { status: 404 });
  }
  const member = await db.groupMember.update({ where, data: { role } });

  invalidateGroup(params.id);
  return NextResponse.json({ member });
}

// DELETE /api/groups/:id/members/:userId … メンバー削除
export async function DELETE(_req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { count } = await db.groupMember.deleteMany({
    where: { groupId: params.id, userId: params.userId },
  });
  if (count === 0) return NextResponse.json({ error: "not a member" }, { status: 404 });

  invalidateGroup(params.id);
  return NextResponse.json({ ok: true });
}
