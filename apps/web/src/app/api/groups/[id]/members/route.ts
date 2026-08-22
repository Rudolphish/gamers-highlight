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

  // **upsert の戻り値からは「今回新しく入ったのか」が分からない。**
  // このエンドポイントで作られたメンバーは acceptedAt が入らない
  // （acceptedAt を書くのは招待リンク経由の acceptInvite だけ）ので、
  // 「acceptedAt が null なら新規」と判定すると、役割変更で呼び直すたびに
  // member.joined が増えて「同じ人が何度も加入した」記録になる。
  // 先に有無を見てから分岐する（オーナーだけが叩く低頻度の操作なので1往復増えてよい）。
  const before = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: params.id, userId: invitee.id } },
    select: { id: true },
  });

  const member = await db.groupMember.upsert({
    where: { groupId_userId: { groupId: params.id, userId: invitee.id } },
    update: { role: body.role },
    create: { groupId: params.id, userId: invitee.id, role: body.role },
  });

  invalidateGroup(params.id);

  if (!before) {
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
