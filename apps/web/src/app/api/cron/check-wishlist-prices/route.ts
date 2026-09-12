import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getItadSummary } from "@/lib/itad";
import { postDiscordMessage } from "@/lib/discord";
import { listNotificationTargets } from "@/lib/notificationTargets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/check-wishlist-prices … Vercel Cronから日次で呼ばれる。
// 「最安値の更新」の通知先を設定しているグループのWISHLISTゲームについて、IsThereAnyDealの
// 過去最安値が前回チェック時より下がっていたらDiscordチャンネルに通知する。
// 初回チェック（前回記録が無い）は基準値を記録するだけで通知はしない（誤検知防止）。
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 送り先は種類ごとに決める（lib/notificationTargets.ts）。
  // **この種類の設定が無いグループは調べもしない**——通知しないのに
  // ITADへ問い合わせても、外部APIを無駄に叩くだけになる
  const targets = await listNotificationTargets("PRICE_DROP");
  const channelByGroupId = new Map(targets.map((t) => [t.groupId, t.channelId]));

  const groups = await db.group.findMany({
    where: { id: { in: targets.map((t) => t.groupId) } },
    include: {
      games: {
        where: { status: "WISHLIST" },
        include: { interests: { include: { user: true } } },
      },
    },
  });

  const tasks = groups.flatMap((group) =>
    group.games.map((game) => ({ channelId: channelByGroupId.get(group.id)!, game }))
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
        // 「気になってる」マークを付けたメンバーがいれば添える。@メンションだと通知が
        // うるさくなりうるので、あくまで名前の列挙にとどめる。
        // 表示名が未設定でもメールアドレスにはフォールバックしない（Discordチャンネルに
        // メールアドレスを流さないため）。画面側の表示と同じく「メンバー」に寄せる。
        const interestedNames = game.interests.map((i) => i.user.name ?? "メンバー");

        const message = [
          `📉 **${game.title}** が最安値を更新しました！`,
          `¥${summary.lowPrice.toLocaleString("ja-JP")}（${summary.lowShopName}）`,
          ...(interestedNames.length > 0 ? [`👀 気になってる: ${interestedNames.join("、")}`] : []),
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
