import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/users … ログイン済みメンバー一覧（招待候補選択用）
// 招待制のクローズドな友人グループ運用のため、登録済みユーザーを一覧表示しても問題ない前提。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, avatarUrl: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}
