import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";

// GET /api/search/group-games?q=… 自分が所属するグループの「ゲームリスト」「ゲーム提案」を
// タイトルであいまい検索する（/searchページの「ゲームタイトル」欄と連動）。
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ games: [], proposals: [] });

  const groups = await db.group.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return NextResponse.json({ games: [], proposals: [] });

  const [games, proposals] = await Promise.all([
    db.groupGame.findMany({
      where: { groupId: { in: groupIds }, title: { contains: q, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: { group: { select: { id: true, name: true } } },
    }),
    db.groupGameProposal.findMany({
      where: { groupId: { in: groupIds }, status: "PENDING", title: { contains: q, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { group: { select: { id: true, name: true } } },
    }),
  ]);

  return NextResponse.json({
    games: games.map((g) => ({
      id: g.id,
      groupId: g.groupId,
      groupName: g.group.name,
      title: g.title,
      coverUrl: g.coverUrl,
      status: g.status,
    })),
    proposals: proposals.map((p) => ({
      id: p.id,
      groupId: p.groupId,
      groupName: p.group.name,
      title: p.title,
      coverUrl: p.coverUrl,
    })),
  });
}
