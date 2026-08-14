import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { acceptInvite, clearInviteCookie, INVALID_REASON_TEXT } from "@/lib/groupInvites";

// POST /api/invites/:token/accept … 招待リンクからグループに加入する。
//
// ログイン必須。未登録の人は先にDiscordログインを通り、その過程で
// 許可リストへの登録が代行される（lib/groupInvites.ts の registerAllowlistFromInvite）。
// ここに来る時点では既にログイン済みなので、あとはグループに入れるだけ。
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await acceptInvite(params.token, user.id);

  // 成否によらず、役目を終えたCookieは残さない
  clearInviteCookie();

  if (!result.ok) {
    return NextResponse.json({ error: INVALID_REASON_TEXT[result.reason] }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    groupId: result.groupId,
    alreadyMember: result.alreadyMember,
  });
}
