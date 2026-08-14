import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { purgePendingInviteAllowlist } from "@/lib/groupInvites";

// DELETE /api/groups/:id/invites/:inviteId … 招待リンクを取り消す（OWNERのみ）。
//
// レコードごと消さずrevokedAtを立てるのは、誰がいつ使ったかの記録（GroupInviteUse）を残すため。
// 誤った相手に送ってしまった時に即座に止められる手段が無いと、有効期限が切れるまで
// リンクが生きたままになる。
//
// **取り消しはグループ加入を止めるだけでは足りない。** リンクを踏んでログインまで
// 済ませた相手は既に許可リストに載っており、放置するとアプリには入れたままになる。
// まだ加入していない相手の登録はここで回収する（加入済みの相手は正式なメンバーなので、
// グループのメンバー一覧と許可リスト画面から個別に外す）。
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; inviteId: string } }
) {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, actor.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // グループを跨いだIDの取り違えで他グループの招待を消さないよう、groupIdでも絞る
  const updated = await db.groupInvite.updateMany({
    where: { id: params.inviteId, groupId: params.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const revokedAccess = await purgePendingInviteAllowlist();

  return NextResponse.json({ ok: true, revokedAccess });
}
