// 「アプデ待ち」（GroupGame.status = WAITING_UPDATE）のゲームに、更新が来たかを見張る（2026-11-03 ユーザー判断）。
//
// - **見るのは Steam の公式のお知らせのうち「パッチノート」の印が付いたものだけ**（ユーザーが選んだ）。
//   セール・イベント・ロードマップの告知では鳴らない。印を付けない開発元だと取りこぼす
// - 公式のお知らせに絞るのは `feeds=steam_community_announcements`（Valve の公式資料にある指定）。
//   パッチノートかどうかは**応答の `tags` に `patchnotes` があるか**で手元で判定する。要求の `tags=` 指定は
//   有志のリファレンスにしか載っていないので頼らない
// - **応答の形は本番でしか確かめられない**（開発環境から api.steampowered.com に繋がらない）。印が1件も返ってこないと
//   黙って0件になるので、毎回の件数を `AppSetting`（`gameUpdateLastCheck`）に残す。本番に出したらここを見て確かめる
// - アプデ待ちにした時刻（`updateWatchSince`）より後に出たものだけを数える。見つけたら起点をそのお知らせの日時へ進める
// - 呼ぶのは日次cron（check-wishlist-prices に相乗り。Hobby プランの cron は1日1回までで、枠も2つとも使っている）
// - **送れなかったら何も進めない**（「更新あり」も起点も）。次の日にもう一度見つけて送る
//   （CLAUDE.md「取りこぼさないための記録は、失敗したら進めてはいけない」）。送り先が無いグループは送らずに進める
import { db } from "./db";
import { logActivity } from "./activityLog";
import { getNotificationChannel } from "./notificationTargets";
import { postDiscordMessage } from "./discord";
import { invalidateGroup } from "./cacheTags";

export type UpdateNews = { gid: string; title: string; url: string; date: number; tags: string[] | null };

/** 公式のお知らせ（新しい順）。取れなければ null（そのゲームは今日は見送る） */
export async function fetchOfficialNews(steamAppId: number): Promise<UpdateNews[] | null> {
  const url =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${steamAppId}` +
    "&count=10&maxlength=1&feeds=steam_community_announcements&format=json";
  try {
    // 毎日の見張りなので、取り置きは使わない（CLAUDE.md「fetch のキャッシュは必ず明示する」）
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[update] app=${steamAppId} のお知らせを取れませんでした status=${res.status}`);
      return null;
    }
    const data = await res.json();
    const items: unknown[] = Array.isArray(data?.appnews?.newsitems) ? data.appnews.newsitems : [];
    return items
      .filter(
        (i): i is { gid: string; title: string; url: string; date: number; tags?: unknown } =>
          typeof i === "object" &&
          i !== null &&
          typeof (i as { gid?: unknown }).gid === "string" &&
          typeof (i as { title?: unknown }).title === "string" &&
          typeof (i as { date?: unknown }).date === "number"
      )
      .map((i) => ({
        gid: i.gid,
        title: i.title,
        url: typeof i.url === "string" ? i.url : "",
        date: i.date,
        tags: Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === "string") : null,
      }))
      .sort((a, b) => b.date - a.date);
  } catch (e) {
    console.error(`[update] app=${steamAppId} のお知らせを取れませんでした`, e);
    return null;
  }
}

export function isPatchNotes(n: UpdateNews): boolean {
  return n.tags?.includes("patchnotes") ?? false;
}

/** 「更新あり（11/3）」。日本時間で作る（サーバーは UTC。クライアント部品に渡す前にサーバーで文字にする。CLAUDE.md） */
export function updateFoundLabel(foundAt: Date | string): string {
  const day = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(
    new Date(foundAt)
  );
  return `更新あり（${day}）`;
}

export type GameUpdateCheckResult = {
  /** 見張っているゲーム（グループ×ゲーム）の数 */
  watched: number;
  /** 問い合わせたゲーム（steamAppId）の数と、取れなかった数 */
  apps: number;
  fetchFailed: number;
  /** 取れたお知らせの件数・そのうち tags が付いていた件数・パッチノートの件数（本番で応答の形を確かめるため） */
  officialItems: number;
  taggedItems: number;
  patchNotes: number;
  found: number;
  notified: number;
  failed: number;
};

export async function checkGameUpdates(now = new Date()): Promise<GameUpdateCheckResult> {
  const games = await db.groupGame.findMany({
    where: { status: "WAITING_UPDATE" },
    select: { id: true, groupId: true, steamAppId: true, title: true, updateWatchSince: true },
  });

  const result: GameUpdateCheckResult = {
    watched: games.length,
    apps: 0,
    fetchFailed: 0,
    officialItems: 0,
    taggedItems: 0,
    patchNotes: 0,
    found: 0,
    notified: 0,
    failed: 0,
  };

  // 同じゲームを複数のグループが待っていても、問い合わせは1回
  const appIds = [...new Set(games.map((g) => g.steamAppId))];
  result.apps = appIds.length;
  const newsByApp = new Map<number, UpdateNews[]>();
  await Promise.all(
    appIds.map(async (appId) => {
      const news = await fetchOfficialNews(appId);
      if (!news) {
        result.fetchFailed++;
        return;
      }
      result.officialItems += news.length;
      result.taggedItems += news.filter((n) => n.tags !== null && n.tags.length > 0).length;
      result.patchNotes += news.filter(isPatchNotes).length;
      newsByApp.set(appId, news);
    })
  );

  const channels = new Map<string, string | null>();
  for (const game of games) {
    const news = newsByApp.get(game.steamAppId);
    if (!news) continue;
    // 起点が無い行（列を足す前にアプデ待ちだった・直接書き換えた）は、今を起点にして今回は数えない（古いお知らせで鳴らさない）
    if (!game.updateWatchSince) {
      await db.groupGame.updateMany({ where: { id: game.id, updateWatchSince: null }, data: { updateWatchSince: now } });
      continue;
    }
    const since = game.updateWatchSince.getTime();
    const latest = news.find((n) => isPatchNotes(n) && n.date * 1000 > since);
    if (!latest) continue;
    result.found++;

    if (!channels.has(game.groupId)) channels.set(game.groupId, await getNotificationChannel(game.groupId, "GAME_UPDATE"));
    const channelId = channels.get(game.groupId);
    if (channelId) {
      const message = [
        `🆕 アプデ待ちの **${game.title}** に更新が来ました`,
        latest.title,
        ...(latest.url ? [latest.url] : []),
      ].join("\n");
      if (!(await postDiscordMessage(channelId, message))) {
        // 送れなかったら何も進めない（上のコメント）。次の日にもう一度送る
        result.failed++;
        console.error(`[update] 通知に失敗しました gameId=${game.id} channelId=${channelId}`);
        continue;
      }
      result.notified++;
    }

    const foundAt = new Date(latest.date * 1000);
    // 起点を条件に付けて書く（同じ日に2回走っても二重に記録しない）。その間に状態が変わっていたら書かない
    const { count } = await db.groupGame.updateMany({
      where: { id: game.id, status: "WAITING_UPDATE", updateWatchSince: game.updateWatchSince },
      data: {
        updateWatchSince: foundAt,
        updateFoundAt: foundAt,
        updateNewsTitle: latest.title.slice(0, 300),
        updateNewsUrl: latest.url || null,
      },
    });
    if (count === 0) continue;
    // グループ画面はキャッシュしているので、カードに「更新あり」を出すために作り直す（lib/cacheTags.ts）
    invalidateGroup(game.groupId);
    await logActivity({
      kind: "game.update_found",
      targetId: game.id,
      targetName: game.title,
      groupId: game.groupId,
      occurredAt: foundAt,
      detail: { title: latest.title.slice(0, 300) },
    });
  }

  // 本番で応答の形を確かめるための記録（上のコメント）。失敗してもcronは止めない
  await db.appSetting
    .upsert({
      where: { key: "gameUpdateLastCheck" },
      update: { value: JSON.stringify({ at: now.toISOString(), ...result }) },
      create: { key: "gameUpdateLastCheck", value: JSON.stringify({ at: now.toISOString(), ...result }) },
    })
    .catch((e) => console.error("[update] 確認の記録に失敗しました", e));
  console.log(`[update] ${JSON.stringify(result)}`);
  return result;
}
