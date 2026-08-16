import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";

/**
 * NextAuthのDiscordプロバイダでログインした時点で
 * lib/auth.ts の signIn コールバックが discordUserId を自動保存する。
 * このエンドポイントは「現在の連携状況を確認する」用途で使う。
 */
export async function GET() {
  const current = await getCurrentUser();
  if (!current) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // discordUserId はセッションに載せていないので、ここだけ引く
  const user = await db.user.findUnique({
    where: { id: current.id },
    select: { discordUserId: true },
  });
  return NextResponse.json({ linked: Boolean(user?.discordUserId) });
}
