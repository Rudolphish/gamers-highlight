import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Discord Botが「どのゲーム？」と聞くときの選択肢を取る内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * GET /api/internal/group-games?guildId=...
 *
 * Discordのセレクトメニューは25件までなので、多い場合は新しい順に切る。
 */
const MAX_OPTIONS = 25;

export async function GET(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const guildId = new URL(req.url).searchParams.get("guildId");
  if (!guildId) return NextResponse.json({ error: "guildId required" }, { status: 400 });

  const group = await db.group.findUnique({ where: { guildId }, select: { id: true } });
  if (!group) return NextResponse.json({ games: [] });

  const games = await db.groupGame.findMany({
    where: { groupId: group.id },
    orderBy: { updatedAt: "desc" },
    take: MAX_OPTIONS,
    select: { steamAppId: true, title: true },
  });

  return NextResponse.json({ games });
}
