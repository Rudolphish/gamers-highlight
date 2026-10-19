import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cronAuth";
import { db } from "@/lib/db";
import { getItadSummary } from "@/lib/itad";
import { postDiscordMessage } from "@/lib/discord";
import { listNotificationTargets } from "@/lib/notificationTargets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/check-wishlist-prices … Vercel Cronから日次で呼ばれる。
// 「最安値の更新」の通知先を設定しているグループについて、IsThereAnyDealの過去最安値が
// 前回チェック時より下がっていたらDiscordチャンネルに通知する。
// 初回チェック（前回記録が無い）は基準値を記録するだけで通知はしない（誤検知防止）。
//
// **見張るのは2か所**（2026-10-19 ユーザー判断）:
// - 「みんなのゲーム」でステータスが「気になる」（WISHLIST）のゲーム（GroupGame）
// - 画面で「ウィッシュリスト」と呼んでいる区画の、まだ採用されていない候補（GroupGameProposal の PENDING）。
//   採用されたものは「気になる」としてゲームリストに入るので、そちらで見張られる
// 同じグループで同じゲームが両方にあっても、ITADへの問い合わせと通知は1回にまとめる。
// 問い合わせはグループをまたいでも1ゲーム1回（同じゲームを複数のグループが見ていても無駄に叩かない）。
//
// **送れなかったら最安値の記録を進めない。** 先に記録してから送ると、Discordが落ちていた・Botが外されていた日の
// 値下がりは「もう知っている値」になって二度と通知されない（CLAUDE.md「取りこぼさないための記録は、失敗したら進めてはいけない」）。
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 送り先は種類ごとに決める（lib/notificationTargets.ts）。
  // **この種類の設定が無いグループは調べもしない**——通知しないのに
  // ITADへ問い合わせても、外部APIを無駄に叩くだけになる
  const targets = await listNotificationTargets("PRICE_DROP");
  const channelByGroupId = new Map(targets.map((t) => [t.groupId, t.channelId]));

  const groups = await db.group.findMany({
    where: { id: { in: targets.map((t) => t.groupId) } },
    select: {
      id: true,
      games: {
        where: { status: "WISHLIST" },
        select: {
          id: true,
          steamAppId: true,
          title: true,
          lastKnownLowPrice: true,
          interests: { select: { user: { select: { name: true } } } },
        },
      },
      proposals: {
        where: { status: "PENDING" },
        select: {
          id: true,
          steamAppId: true,
          title: true,
          lastKnownLowPrice: true,
          proposedBy: { select: { name: true } },
        },
      },
    },
  });

  // グループ × ゲーム（steamAppId）ごとにまとめる
  type Watch = {
    channelId: string;
    steamAppId: number;
    title: string;
    gameIds: string[];
    proposalIds: string[];
    previousLows: number[];
    interestedNames: Set<string>;
    proposerNames: Set<string>;
  };
  const watches: Watch[] = [];
  for (const group of groups) {
    const byApp = new Map<number, Watch>();
    const watchOf = (steamAppId: number, title: string) => {
      let w = byApp.get(steamAppId);
      if (!w) {
        w = {
          channelId: channelByGroupId.get(group.id)!,
          steamAppId,
          title,
          gameIds: [],
          proposalIds: [],
          previousLows: [],
          interestedNames: new Set(),
          proposerNames: new Set(),
        };
        byApp.set(steamAppId, w);
      }
      return w;
    };
    for (const game of group.games) {
      // ゲームリストの名前を優先する（ウィッシュリスト側の名前より先に入れる）
      const w = watchOf(game.steamAppId, game.title);
      w.title = game.title;
      w.gameIds.push(game.id);
      if (game.lastKnownLowPrice !== null) w.previousLows.push(game.lastKnownLowPrice);
      // 表示名が未設定でもメールアドレスにはフォールバックしない（Discordチャンネルにメールアドレスを流さないため）
      for (const i of game.interests) w.interestedNames.add(i.user.name ?? "メンバー");
    }
    for (const proposal of group.proposals) {
      const w = watchOf(proposal.steamAppId, proposal.title);
      w.proposalIds.push(proposal.id);
      if (proposal.lastKnownLowPrice !== null) w.previousLows.push(proposal.lastKnownLowPrice);
      w.proposerNames.add(proposal.proposedBy.name ?? "メンバー");
    }
    watches.push(...byApp.values());
  }

  const summaries = new Map<number, ReturnType<typeof getItadSummary>>();
  const summaryOf = (steamAppId: number) => {
    let p = summaries.get(steamAppId);
    if (!p) {
      p = getItadSummary(steamAppId);
      summaries.set(steamAppId, p);
    }
    return p;
  };

  let checked = 0;
  let notified = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    watches.map(async (w): Promise<"notified" | "failed" | "checked" | null> => {
      const summary = await summaryOf(w.steamAppId);
      if (!summary) return null;

      // 前回の記録が複数ある（両方に入っている）ときは、いちばん安いものと比べる（同じ値下がりで二度鳴らさない）
      const previousLow = w.previousLows.length > 0 ? Math.min(...w.previousLows) : null;
      const dropped = previousLow !== null && summary.lowPrice < previousLow;

      if (dropped) {
        // 名前の列挙にとどめる（@メンションだと通知がうるさくなりうる）
        const message = [
          `📉 **${w.title}** が最安値を更新しました！`,
          `¥${summary.lowPrice.toLocaleString("ja-JP")}（${summary.lowShopName}）`,
          ...(w.proposerNames.size > 0 ? [`📝 ${[...w.proposerNames].join("、")}のウィッシュリスト`] : []),
          ...(w.interestedNames.size > 0 ? [`👀 気になってる: ${[...w.interestedNames].join("、")}`] : []),
          summary.pageUrl,
        ].join("\n");
        // **送れなかったら記録を進めない**（上のコメント）。次の日にもう一度送る
        if (!(await postDiscordMessage(w.channelId, message))) return "failed";
      }

      const data = { lastKnownLowPrice: summary.lowPrice, lastKnownLowShop: summary.lowShopName, lastPriceCheckedAt: new Date() };
      await Promise.all([
        w.gameIds.length > 0 ? db.groupGame.updateMany({ where: { id: { in: w.gameIds } }, data }) : null,
        w.proposalIds.length > 0 ? db.groupGameProposal.updateMany({ where: { id: { in: w.proposalIds } }, data }) : null,
      ]);
      return dropped ? "notified" : "checked";
    })
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || result.value === null) continue;
    if (result.value === "failed") {
      failed++;
      continue;
    }
    checked++;
    if (result.value === "notified") notified++;
  }

  return NextResponse.json({ checked, notified, failed, total: watches.length });
}
