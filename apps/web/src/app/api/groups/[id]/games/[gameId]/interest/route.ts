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

  // 「取得してから分岐」だと、二重クリックや複数タブからの同時POSTで
  // @@unique([groupGameId, userId]) 違反や「既に消えている行のdelete」が起きて500になる。
  // まず消してみて、消せなかった＝付いていなかった、と判断する形にすると
  // どちらの経路も競合時に例外を投げない（deleteManyは0件でも、
  // createManyのskipDuplicatesは重複でも成功する）。
  const deleted = await db.groupGameInterest.deleteMany({
    where: { groupGameId: game.id, userId: user.id },
  });
  const interested = deleted.count === 0;
  if (interested) {
    await db.groupGameInterest.createMany({
      data: { groupGameId: game.id, userId: user.id },
      skipDuplicates: true,
    });
  }

  const count = await db.groupGameInterest.count({ where: { groupGameId: game.id } });

  return NextResponse.json({ interested, count });
}
