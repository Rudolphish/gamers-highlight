import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { listGuildTextChannels } from "@/lib/discord";

// GET /api/groups/:id/discord-channels … 通知先チャンネル設定のプルダウン用。
// グループにguildIdが設定されていない、またはBotがそのサーバーに参加していない場合は
// channels: null を返す（呼び出し側はチャンネルID手打ちにフォールバックする）。
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isOwner = await hasGroupPermission(params.id, user.id, "OWNER");
  if (!isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const group = await db.group.findUnique({ where: { id: params.id }, select: { guildId: true } });
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!group.guildId) return NextResponse.json({ channels: null });

  const channels = await listGuildTextChannels(group.guildId);
  return NextResponse.json({ channels });
}
