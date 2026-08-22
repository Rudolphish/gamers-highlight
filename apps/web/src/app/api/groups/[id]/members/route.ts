import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";

// POST /api/groups/:id/members … メンバー招待（権限指定）
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json(); // { email: string, role: "EDITOR" | "VIEWER" }
  const invitee = await db.user.findUnique({ where: { email: body.email } });
  if (!invitee) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const member = await db.groupMember.upsert({
    where: { groupId_userId: { groupId: params.id, userId: invitee.id } },
    update: { role: body.role },
    create: { groupId: params.id, userId: invitee.id, role: body.role },
  });

  invalidateGroup(params.id);

  // 既存メンバーの役割変更ではなく、**新しく入った時だけ**記録する
  // （upsert なので、両方をここで区別する）
  if (member.acceptedAt == null || member.invitedAt.getTime() === member.acceptedAt.getTime()) {
    await logActivity({
      kind: "member.joined",
      targetId: invitee.id,
      targetName: invitee.name ?? invitee.email,
      groupId: params.id,
      actorId: invitee.id,
      occurredAt: member.acceptedAt ?? member.invitedAt,
    });
  }

  return NextResponse.json({ member }, { status: 201 });
}
