import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

// DELETE /api/groups/:id/proposals/:proposalId … 提案の却下/取り下げ。
// 提案した本人、またはEDITOR以上の権限を持つメンバーが削除できる。
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; proposalId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.id },
  });
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isProposer = proposal.proposedById === user.id;
  const isEditor = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!isProposer && !isEditor) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.groupGameProposal.delete({ where: { id: params.proposalId } });
  return NextResponse.json({ ok: true });
}
