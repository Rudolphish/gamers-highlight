import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { purgePendingInviteAllowlist } from "@/lib/groupInvites";
import { dbErrorResponse } from "@/lib/dbError";

// DELETE /api/admin/invites/:inviteId … 管理者としてどのグループの招待リンクでも取り消す。
//
// グループ単位の取り消し（/api/groups/:id/invites/:inviteId）はOWNER限定なので、
// **管理者がオーナーでないグループのリンクを止められない。** 招待リンクは許可リストへの
// 入口＝アプリ全体のログイン権限に関わるため、管理者にも止める手段が要る。
//
// 権限判定はセッションの isAdmin ではなく、必ずサーバー側で isAdminEmail を呼ぶ。
export async function DELETE(
  _req: Request,
  { params }: { params: { inviteId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const updated = await db.groupInvite.updateMany({
      where: { id: params.inviteId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // 取り消しただけでは、既にログインを済ませた相手はアプリに入れたままになる
    const revokedAccess = await purgePendingInviteAllowlist();

    return NextResponse.json({ ok: true, revokedAccess });
  } catch (e) {
    return dbErrorResponse("admin:invite-revoke", e);
  }
}
