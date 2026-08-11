import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { postDiscordMessage } from "@/lib/discord";
import { checkFreeTierUsage } from "@/lib/usageAlerts";

export const dynamic = "force-dynamic";

// Botが生存報告(lastSeenAt)を送ってこなくなってからこの時間以上経っていたら「落ちている」とみなす。
// Vercel Cron自体は日次でしか呼ばれない（Hobbyプランの制約）ため、通常の生存間隔(数十分おき)
// よりは十分長く、かつ日次チェックの間隔よりは短い値にしている。
const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3時間

// GET /api/cron/check-bot-health … Vercel Cronから日次で呼ばれる、日次の見張り全般。
//
// 1. Discord Bot（apps/bot、PM2常駐プロセス）のハートビートが途絶えていないか
// 2. 無料枠（R2・DB）の使用率が閾値を超えていないか
//
// **パス名はBotの死活監視だけを指しているが、実際は上の2つを行う。**
// Hobbyプランのcronは2本までで既に埋まっており（もう1本はcheck-wishlist-prices）、
// 3本目を足せないため日次の処理をここに相乗りさせている。
// 日次の見張りを増やす場合もここに足すこと。
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 片方が落ちてももう片方は動かす（見張りが見張りを巻き込まないように）
  const usage = await checkFreeTierUsage().catch((e) => {
    console.error("[cron] free tier usage check failed", e);
    return null;
  });

  const heartbeat = await db.botHeartbeat.findUnique({ where: { id: "bot" } });
  const now = Date.now();
  const staleMs = heartbeat ? now - heartbeat.lastSeenAt.getTime() : null;
  const isDown = staleMs === null || staleMs > STALE_THRESHOLD_MS;

  if (!isDown) {
    return NextResponse.json({ ok: true, down: false, lastSeenAt: heartbeat!.lastSeenAt, usage });
  }

  const groups = await db.group.findMany({
    where: { notificationChannelId: { not: null } },
    select: { notificationChannelId: true },
  });
  const channelIds = [...new Set(groups.map((g) => g.notificationChannelId!))];

  const message = heartbeat
    ? `⚠️ Discord Botからの生存報告が${Math.round(staleMs! / (60 * 1000))}分間ありません。PC/PM2の状態を確認してください（\`pm2 status\` / \`pm2 resurrect\`）。`
    : `⚠️ Discord Botからの生存報告がまだ一度もありません。起動しているか確認してください。`;

  const results = await Promise.allSettled(channelIds.map((id) => postDiscordMessage(id, message)));
  const notified = results.filter((r) => r.status === "fulfilled" && r.value).length;

  return NextResponse.json({
    ok: true,
    down: true,
    lastSeenAt: heartbeat?.lastSeenAt ?? null,
    notified,
    usage,
  });
}
