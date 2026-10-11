import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEligibleMembers } from "@/lib/playLog";

/**
 * プレイ記録で数えてよい人（Discord連携済み・外れていない・オーナーかメンバー）の Discord ユーザーID。
 * Botはこれに入っていない人のプレイ状況をメモリ上で捨て、Webへは送らない。
 *
 * GET /api/internal/play-log/members?guildId=...
 *
 * グループが無いサーバーは `{ group: false }`。Botはそのサーバーを見ない。
 */
export async function GET(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const guildId = new URL(req.url).searchParams.get("guildId");
  if (!guildId) return NextResponse.json({ error: "guildId required" }, { status: 400 });

  const group = await db.group.findUnique({ where: { guildId }, select: { id: true } });
  if (!group) return NextResponse.json({ group: false, discordUserIds: [] });

  const eligible = await getEligibleMembers(group.id);
  return NextResponse.json({ group: true, discordUserIds: [...eligible.keys()] });
}
