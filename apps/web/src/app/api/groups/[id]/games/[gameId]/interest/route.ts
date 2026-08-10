import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

// POST /api/groups/:id/games/:gameId/interest … 「気になってる」マークをトグルする。
// ゲームのステータス変更（EDITOR以上）と違い、これは各メンバーが自分の興味を表明するだけの
// 軽いマークなので、閲覧できるメンバー（VIEWER以上）なら誰でも付け外しできる。
export async function POST(
  _req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // gameIdが本当にこのグループのゲームかを確認する（他グループのIDを指定されないように）
  const game = await db.groupGame.findUnique({
    where: { id: params.gameId, groupId: params.id },
    select: { id: true },
  });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });

  const existing = await db.groupGameInterest.findUnique({
    where: { groupGameId_userId: { groupGameId: game.id, userId: user.id } },
  });

  if (existing) {
    await db.groupGameInterest.delete({ where: { id: existing.id } });
  } else {
    await db.groupGameInterest.create({
      data: { groupGameId: game.id, userId: user.id },
    });
  }

  const count = await db.groupGameInterest.count({ where: { groupGameId: game.id } });

  return NextResponse.json({ interested: !existing, count });
}
