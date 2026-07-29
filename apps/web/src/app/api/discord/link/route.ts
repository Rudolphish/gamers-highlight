import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * NextAuthのDiscordプロバイダでログインした時点で
 * lib/auth.ts の signIn コールバックが discordUserId を自動保存する。
 * このエンドポイントは「現在の連携状況を確認する」用途で使う。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  return NextResponse.json({ linked: Boolean(user?.discordUserId) });
}
