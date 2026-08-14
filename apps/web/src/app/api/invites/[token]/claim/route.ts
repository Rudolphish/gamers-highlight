import { NextResponse } from "next/server";
import {
  findInviteByToken,
  validateInvite,
  setInviteCookie,
  INVALID_REASON_TEXT,
} from "@/lib/groupInvites";

// POST /api/invites/:token/claim … Discordログインへ入る直前に、招待トークンをCookieへ預ける。
//
// **未ログインから呼ばれるので認証は掛けない。** ここで置くのは招待トークンそのもので、
// 権限を与えるものではない（有効性の判定はログイン時と加入時に改めて行う）。
// 無効なトークンをCookieに残しても意味がないので、その場合は置かずに断る。
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const invite = await findInviteByToken(params.token);
  const result = validateInvite(invite);

  if (!result.ok) {
    return NextResponse.json({ error: INVALID_REASON_TEXT[result.reason] }, { status: 400 });
  }

  setInviteCookie(params.token);
  return NextResponse.json({ ok: true });
}
