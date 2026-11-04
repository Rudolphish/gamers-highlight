// ゲームに更新（Steam の公式のパッチノート）が来たかを見張る。
//
// 2026-11-03 に「アプデ待ち」のゲームだけで始め、2026-11-04 に「クリア済み」以外の全部へ広げた（ユーザー判断）。
//
// - **見るのは Steam の公式のお知らせのうち「パッチノート」の印が付いたものだけ**（ユーザーが選んだ）。
//   セール・イベント・ロードマップの告知では鳴らない。印を付けない開発元だと取りこぼす
// - 公式のお知らせに絞るのは `feeds=steam_community_announcements`（Valve の公式資料にある指定）。
//   パッチノートかどうかは**応答の `tags` に `patchnotes` があるか**で手元で判定する。要求の `tags=` 指定は
//   有志のリファレンスにしか載っていないので頼らない。**応答の形は 2026-11-04 の本番の初回で確かめた**
//   （公式のお知らせ10件・印付き9件・パッチノート4件）。黙って0件にならないよう、毎回の件数は今も
//   `AppSetting`（`gameUpdateLastCheck`）に残す
// - 拾ったパッチノートは `GamePatchNote` にためる（グループ画面の「アプデ情報」。lib/gameUpdates の listRecentPatchNotes）。
//   ゲーム単位で持ち、90日より古いものは消す
// - 見張り始めた時刻（`updateWatchSince`）より後に出たものだけを「更新」と数えて知らせる。知らせたら起点をそのお知らせの日時へ進める。
//   起点が無いゲーム（新しく足した・クリア済みから戻した直後の確認より前）は、今を起点にするだけで知らせない（古いお知らせで鳴らさない）
// - **通知はグループごとに1日1通にまとめる**（運営型のゲームはパッチノートが週に何度も出るため）。送り先は種類 GAME_UPDATE
// - **送れなかったグループは何も進めない**（起点も「更新あり」も）。次の日にもう一度見つけて送る
//   （CLAUDE.md「取りこぼさないための記録は、失敗したら進めてはいけない」）。送り先が無いグループは送らずに進める
// - カードの「更新あり」と活動の記録（game.update_found）は**アプデ待ちのゲームだけ**（「再開してよい」の合図なので）
// - 呼ぶのは日次cron（check-wishlist-prices に相乗り。Hobby プランの cron は1日1回までで、枠も2つとも使っている）
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

/** 「11/3 14:05」。日本時間 */
export function patchNoteTimeLabel(at: Date | string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 見張る対象（「クリア済み」以外） */
const WATCHED = { not: "COMPLETED" } as const;

/** 1通に並べる更新の上限（Discord の本文は 2000 文字まで。超えた分は「ほか N 件」にする） */
const DIGEST_MAX_ITEMS = 10;
const DIGEST_MAX_CHARS = 1900;
/** ためておく期間 */
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
/** 同時に問い合わせる数（cron の実行時間の上限 60 秒に収めるため、少しずつ並べる） */
const FETCH_CONCURRENCY = 4;

type Found = {
  id: string;
  groupId: string;
  title: string;
  status: string;
  since: Date;
  latest: UpdateNews;
  /** 起点より後に出たパッチノートの数（1通の中で「ほか N 件」と書く） */
  count: number;
};

/** グループごとの1日1通の本文。URL は <> で囲んでプレビューを出さない（何本も並ぶと流れが埋まるため） */
export function formatUpdateDigest(found: { title: string; latest: { title: string; url: string }; count: number }[]): string {
  const head = `🆕 ゲームに更新が来ました（${found.length}本）`;
  const lines: string[] = [head];
  let shown = 0;
  for (const f of found) {
    if (shown >= DIGEST_MAX_ITEMS) break;
    const more = f.count > 1 ? `（ほか${f.count - 1}件）` : "";
    const block = [`・**${f.title}**：${f.latest.title.slice(0, 200)}${more}`, ...(f.latest.url ? [`  <${f.latest.url}>`] : [])].join("\n");
    if ([...lines, block].join("\n").length > DIGEST_MAX_CHARS) break;
    lines.push(block);
    shown++;
  }
  if (shown < found.length) lines.push(`ほか${found.length - shown}本は、グループ画面の「アプデ情報」で見られます`);
  return lines.join("\n");
}

export type GameUpdateCheckResult = {
  /** 見張っているゲーム（グループ×ゲーム）の数 */
  watched: number;
  /** 問い合わせたゲーム（steamAppId）の数と、取れなかった数 */
  apps: number;
  fetchFailed: number;
  /** 取れたお知らせの件数・そのうち tags が付いていた件数・パッチノートの件数（応答の形が変わっていないかを見るため） */
  officialItems: number;
  taggedItems: number;
  patchNotes: number;
  /** 新しくためたパッチノートの件数 */
  stored: number;
  /** 起点より後の更新が見つかったゲーム（グループ×ゲーム）の数 */
  found: number;
  /** 送れたグループ・送れなかったグループの数 */
  notified: number;
  failed: number;
};

/** 並べる数を絞って順に処理する */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function checkGameUpdates(now = new Date()): Promise<GameUpdateCheckResult> {
  const games = await db.groupGame.findMany({
    where: { status: WATCHED },
    select: { id: true, groupId: true, steamAppId: true, title: true, status: true, updateWatchSince: true },
  });

  const result: GameUpdateCheckResult = {
    watched: games.length,
    apps: 0,
    fetchFailed: 0,
    officialItems: 0,
    taggedItems: 0,
    patchNotes: 0,
    stored: 0,
    found: 0,
    notified: 0,
    failed: 0,
  };

  // 同じゲームを複数のグループが持っていても、問い合わせは1回
  const appIds = [...new Set(games.map((g) => g.steamAppId))];
  result.apps = appIds.length;
  const newsByApp = new Map<number, UpdateNews[]>();
  await mapLimit(appIds, FETCH_CONCURRENCY, async (appId) => {
    const news = await fetchOfficialNews(appId);
    if (!news) {
      result.fetchFailed++;
      return;
    }
    result.officialItems += news.length;
    result.taggedItems += news.filter((n) => n.tags !== null && n.tags.length > 0).length;
    const patches = news.filter(isPatchNotes);
    result.patchNotes += patches.length;
    newsByApp.set(appId, news);
    // 「アプデ情報」のためにためる。既にあるもの（gid が同じ）は飛ばす
    if (patches.length > 0) {
      const { count } = await db.gamePatchNote.createMany({
        data: patches.map((p) => ({
          steamAppId: appId,
          gid: p.gid,
          title: p.title.slice(0, 300),
          url: p.url || null,
          publishedAt: new Date(p.date * 1000),
        })),
        skipDuplicates: true,
      });
      result.stored += count;
    }
  });
  await db.gamePatchNote.deleteMany({ where: { publishedAt: { lt: new Date(now.getTime() - KEEP_MS) } } });

  const found: Found[] = [];
  for (const game of games) {
    const news = newsByApp.get(game.steamAppId);
    if (!news) continue;
    // 起点が無い行は、今を起点にして今回は数えない（古いお知らせで鳴らさない）
    if (!game.updateWatchSince) {
      await db.groupGame.updateMany({ where: { id: game.id, updateWatchSince: null }, data: { updateWatchSince: now } });
      continue;
    }
    const since = game.updateWatchSince.getTime();
    const newer = news.filter((n) => isPatchNotes(n) && n.date * 1000 > since);
    if (newer.length === 0) continue;
    found.push({ ...game, since: game.updateWatchSince, latest: newer[0], count: newer.length });
  }
  result.found = found.length;

  const byGroup = new Map<string, Found[]>();
  for (const f of found) byGroup.set(f.groupId, [...(byGroup.get(f.groupId) ?? []), f]);

  for (const [groupId, items] of byGroup) {
    // 新しい順に並べる
    items.sort((a, b) => b.latest.date - a.latest.date);
    const channelId = await getNotificationChannel(groupId, "GAME_UPDATE");
    if (channelId) {
      if (!(await postDiscordMessage(channelId, formatUpdateDigest(items)))) {
        // 送れなかったら、このグループは何も進めない（上のコメント）。次の日にもう一度送る
        result.failed++;
        console.error(`[update] 通知に失敗しました groupId=${groupId} channelId=${channelId}`);
        continue;
      }
      result.notified++;
    }

    let badgeChanged = false;
    for (const f of items) {
      const foundAt = new Date(f.latest.date * 1000);
      const waiting = f.status === "WAITING_UPDATE";
      // 起点を条件に付けて書く（同じ日に2回走っても二重に記録しない）。その間にクリア済みにされていたら書かない
      const { count } = await db.groupGame.updateMany({
        where: { id: f.id, status: WATCHED, updateWatchSince: f.since },
        data: {
          updateWatchSince: foundAt,
          ...(waiting
            ? { updateFoundAt: foundAt, updateNewsTitle: f.latest.title.slice(0, 300), updateNewsUrl: f.latest.url || null }
            : {}),
        },
      });
      if (count === 0 || !waiting) continue;
      badgeChanged = true;
      await logActivity({
        kind: "game.update_found",
        targetId: f.id,
        targetName: f.title,
        groupId,
        occurredAt: foundAt,
        detail: { title: f.latest.title.slice(0, 300) },
      });
    }
    // グループ画面はキャッシュしているので、カードに「更新あり」を出すために作り直す（lib/cacheTags.ts）
    if (badgeChanged) invalidateGroup(groupId);
  }

  // 応答の形が変わっていないかを見るための記録（上のコメント）。失敗してもcronは止めない
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

export type RecentPatchNote = {
  id: string;
  gameId: string;
  gameTitle: string;
  /** 「11/3 14:05」（日本時間。サーバーで作る） */
  timeLabel: string;
  title: string;
  url: string | null;
};

/**
 * グループの「アプデ情報」：クリア済み以外のゲームの、直近 `days` 日のパッチノート（新しい順）。
 * **キャッシュに載せず毎回読む**（グループ画面のキャッシュに入れると、毎朝ためた分を出すために作り直しが要る）
 */
export async function listRecentPatchNotes(
  games: { id: string; steamAppId: number; title: string; status: string }[],
  now = new Date(),
  days = 30
): Promise<RecentPatchNote[]> {
  const watched = games.filter((g) => g.status !== "COMPLETED");
  if (watched.length === 0) return [];
  const gameOf = new Map<number, { id: string; title: string }>();
  for (const g of watched) if (!gameOf.has(g.steamAppId)) gameOf.set(g.steamAppId, { id: g.id, title: g.title });
  const notes = await db.gamePatchNote.findMany({
    where: { steamAppId: { in: [...gameOf.keys()] }, publishedAt: { gte: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) } },
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: { id: true, steamAppId: true, title: true, url: true, publishedAt: true },
  });
  return notes.map((n) => {
    const g = gameOf.get(n.steamAppId)!;
    return { id: n.id, gameId: g.id, gameTitle: g.title, timeLabel: patchNoteTimeLabel(n.publishedAt), title: n.title, url: n.url };
  });
}
