import { NextResponse } from "next/server";
import { setPlayLogOptOut } from "@/lib/playLog";

/**
 * `/playlog on|off|status` の中身。記録から外れる／戻る／いまの状態を返す。
 *
 * POST /api/internal/play-log/opt  { guildId, discordUserId, action: "on" | "off" | "status" }
 *
 * **外れるのはそのサーバーのグループだけ。** 外れても過去の記録は消さない（docs/play-log.md §2）。
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const guildId = body?.guildId;
  const discordUserId = body?.discordUserId;
  const action = body?.action;
  if (typeof guildId !== "string" || typeof discordUserId !== "string") {
    return NextResponse.json({ error: "guildId and discordUserId required" }, { status: 400 });
  }
  if (action !== "on" && action !== "off" && action !== "status") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const status = await setPlayLogOptOut(guildId, discordUserId, action);
  return NextResponse.json({ ok: true, status });
}
