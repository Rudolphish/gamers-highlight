import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

// POST /api/groups/:id/members … メンバー招待（権限指定）
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
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

  return NextResponse.json({ member }, { status: 201 });
}
