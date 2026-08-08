import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Discord Bot（apps/bot、PM2常駐プロセス）が起動時＋定期的に叩く生存報告用の内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * POST /api/internal/bot-heartbeat
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await db.botHeartbeat.upsert({
    where: { id: "bot" },
    update: { lastSeenAt: new Date() },
    create: { id: "bot", lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
