import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getItadSummary } from "@/lib/itad";
import { postDiscordMessage } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/check-wishlist-prices … Vercel Cronから日次で呼ばれる。
// 通知先チャンネルを設定しているグループのWISHLISTゲームについて、IsThereAnyDealの
// 過去最安値が前回チェック時より下がっていたらDiscordチャンネルに通知する。
// 初回チェック（前回記録が無い）は基準値を記録するだけで通知はしない（誤検知防止）。
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const groups = await db.group.findMany({
    where: { notificationChannelId: { not: null } },
    include: { games: { where: { status: "WISHLIST" } } },
  });

  const tasks = groups.flatMap((group) =>
    group.games.map((game) => ({ channelId: group.notificationChannelId!, game }))
  );

  let checked = 0;
  let notified = 0;

  const results = await Promise.allSettled(
    tasks.map(async ({ channelId, game }) => {
      const summary = await getItadSummary(game.steamAppId);
      if (!summary) return;

      const previousLow = game.lastKnownLowPrice;
      const dropped = previousLow !== null && summary.lowPrice < previousLow;

      await db.groupGame.update({
        where: { id: game.id },
        data: {
          lastKnownLowPrice: summary.lowPrice,
          lastKnownLowShop: summary.lowShopName,
          lastPriceCheckedAt: new Date(),
        },
      });

      if (dropped) {
        const message = [
          `📉 **${game.title}** が最安値を更新しました！`,
          `¥${summary.lowPrice.toLocaleString("ja-JP")}（${summary.lowShopName}）`,
          summary.pageUrl,
        ].join("\n");
        await postDiscordMessage(channelId, message);
        return true;
      }
      return false;
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      checked++;
      if (result.value) notified++;
    }
  }

  return NextResponse.json({ checked, notified, total: tasks.length });
}
