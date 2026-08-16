import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { acceptInvite, clearInviteCookie, INVALID_REASON_TEXT } from "@/lib/groupInvites";
import { dbErrorResponse } from "@/lib/dbError";

// POST /api/invites/:token/accept … 招待リンクからグループに加入する。
//
// ログイン必須。未登録の人は先にDiscordログインを通り、その過程で
// 許可リストへの登録が代行される（lib/groupInvites.ts の registerAllowlistFromInvite）。
// ここに来る時点では既にログイン済みなので、あとはグループに入れるだけ。
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
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
  } catch (e) {
    clearInviteCookie();
    return dbErrorResponse("invite:accept", e);
  }
}
