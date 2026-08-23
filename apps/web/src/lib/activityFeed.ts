import { db } from "./db";
import { activityEmoji, type ActivityKind } from "./activityLog";
import { RAW_LOG_RETENTION_DAYS } from "./activityRollup";
import { DAY_MS, JST_OFFSET_MS, dateColumnToString, jstDateColumn, jstDateString } from "./jst";

/**
 * カレンダーとタイムラインの読み取り。設計は docs/activity-log.md §9。
 *
 * **並べる軸は `occurredAt`（実際に起きた日時）。** 週次まとめが `createdAt`（記録時刻）で
 * 数えるのと逆になる。去年撮ったスクショを今日上げたら、カレンダーでは去年のその日に置きたい
 * （週次まとめでは今週の投稿として数えたい）。ここを取り違えると、どちらかが必ず嘘になる。
 *
 * **いまは管理画面（`/admin/activity`）だけが呼ぶ。** グループ向けに出すときは、
 * ページ側で `hasGroupPermission` を通したうえでここを呼べばよい
 * （このファイルは権限を判定しない。`lib/weeklySummary.ts` と同じ役割分担）。
 */

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

export type MonthRange = {
  /** `YYYY-MM` */
  month: string;
  /** JSTでの月初0時（UTCの瞬間） */
  start: Date;
  /** 翌月初0時（UTCの瞬間）。終端は含まない */
  end: Date;
  label: string;
};

/** `YYYY-MM` として読めなければ「今月」を返す。URLのパラメータをそのまま渡してよい */
export function jstMonthRange(month?: string | null, now = new Date()): MonthRange {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const matched = month?.match(/^(\d{4})-(\d{2})$/);
  // Date.UTC の月は0始まりなので、1月＝0 に直す
  const monthIndex = matched ? Number(matched[2]) - 1 : -1;
  const valid = matched !== null && monthIndex >= 0 && monthIndex <= 11;

  const y = valid ? Number(matched![1]) : jstNow.getUTCFullYear();
  const m = valid ? monthIndex : jstNow.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - JST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m + 1, 1) - JST_OFFSET_MS);
  return {
    month: `${y}-${String(m + 1).padStart(2, "0")}`,
    start,
    end,
    label: `${y}年${m + 1}月`,
  };
}

/** `YYYY-MM` を前後に動かす。年またぎは Date.UTC に任せる */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type CalendarDay = {
  /** JSTの `YYYY-MM-DD` */
  date: string;
  day: number;
  weekday: string;
  total: number;
  /** 件数の多い順。0件の種類は入らない */
  counts: { kind: string; emoji: string; count: number }[];
  /**
   * 生ログが残っていて、1件ずつの内訳を出せる日か。
   * false（1年より古い日）なら件数だけ——ロールアップにはそれしか残っていない。
   */
  detailed: boolean;
};

export type MonthCalendar = {
  groupId: string;
  groupName: string;
  range: MonthRange;
  /** その月の全日。0件の日も含む（歯抜けだと「見えていないだけ」と区別できない） */
  days: CalendarDay[];
  /** 月曜始まりで並べたときの、月初より前の空きマス数 */
  leadingBlanks: number;
  total: number;
  /** 濃淡の基準にする、その月で最も多かった日の件数 */
  max: number;
  /** この日より前は生ログが消えている（＝件数だけの表示になる） */
  detailCutoff: string;
};

/**
 * 1か月ぶんのカレンダー。
 *
 * **件数の出どころを日によって変えている。**
 *
 * | その日 | 数える元 | 理由 |
 * |---|---|---|
 * | 生ログが残っている（1年以内） | `ActivityLog` | 今日ぶんも即座に出る |
 * | それより古い | `DailyActivity` | 生ログはもう無い。件数だけが永久に残っている |
 *
 * ロールアップだけを見ると、**日次cronがまだ走っていない今日ぶんが必ず0に見える**。
 * 「さっき投稿したのにカレンダーに出ない」は、機能が動いていないのと区別がつかない。
 * 逆に生ログだけを見ると、1年より前が全部0になる。境界で切り替えるのが唯一まともな形。
 */
export async function getMonthCalendar(
  groupId: string,
  month?: string | null,
  now = new Date()
): Promise<MonthCalendar> {
  const range = jstMonthRange(month, now);

  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) throw new Error(`グループが見つかりません: ${groupId}`);

  // 生ログの境界。この日より前は ActivityLog がもう無い
  const cutoffDate = jstDateString(new Date(now.getTime() - RAW_LOG_RETENTION_DAYS * DAY_MS));
  const cutoffAt = new Date(`${cutoffDate}T00:00:00.000+09:00`);

  const perDay = new Map<string, Map<string, number>>();
  const bump = (date: string, kind: string, count: number) => {
    const kinds = perDay.get(date) ?? new Map<string, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + count);
    perDay.set(date, kinds);
  };

  // 1) 生ログが残っている範囲
  const rawFrom = new Date(Math.max(range.start.getTime(), cutoffAt.getTime()));
  if (rawFrom < range.end) {
    const logs = await db.activityLog.findMany({
      where: { groupId, occurredAt: { gte: rawFrom, lt: range.end } },
      select: { occurredAt: true, kind: true },
    });
    for (const log of logs) bump(jstDateString(log.occurredAt), log.kind, 1);
  }

  // 2) それより古い範囲はロールアップから
  if (range.start < rawFrom) {
    const rolled = await db.dailyActivity.findMany({
      where: {
        groupId,
        date: { gte: jstDateColumn(jstDateString(range.start)), lt: jstDateColumn(cutoffDate) },
      },
      select: { date: true, kind: true, count: true },
    });
    // **読み出した date に9時間を足さない。** 保存時にUTCの0時へ置き直してあるので、
    // これは瞬間ではなく「JSTの日付」そのもの（dateColumnToString のコメント参照）
    for (const row of rolled) bump(dateColumnToString(row.date), row.kind, row.count);
  }

  const days: CalendarDay[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY_MS) {
    const date = jstDateString(new Date(t));
    const kinds = perDay.get(date) ?? new Map<string, number>();
    const counts = [...kinds.entries()]
      .map(([kind, count]) => ({ kind, emoji: activityEmoji(kind), count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    const jst = new Date(t + JST_OFFSET_MS);
    days.push({
      date,
      day: jst.getUTCDate(),
      weekday: WEEKDAYS[(jst.getUTCDay() + 6) % 7],
      total: counts.reduce((sum, c) => sum + c.count, 0),
      counts,
      detailed: date >= cutoffDate,
    });
  }

  const startJst = new Date(range.start.getTime() + JST_OFFSET_MS);
  return {
    groupId: group.id,
    groupName: group.name,
    range,
    days,
    leadingBlanks: (startJst.getUTCDay() + 6) % 7, // 0=日曜 を 月曜起点に直す
    total: days.reduce((sum, d) => sum + d.total, 0),
    max: days.reduce((max, d) => Math.max(max, d.total), 0),
    detailCutoff: cutoffDate,
  };
}

export type TimelineEntry = {
  id: string;
  kind: string;
  emoji: string;
  /** 「写真を投稿」のような文。件数に添える週次まとめのラベルとは言い回しを変えている */
  label: string;
  occurredAt: Date;
  /** 記録時刻。実際に起きた日時と離れているとき（遡っての取り込み）だけ意味がある */
  createdAt: Date;
  actorName: string | null;
  targetName: string | null;
  /** ステータス変更など、detail から作る補足 */
  note: string | null;
  /** 対象を開ける先。対象が消えている場合と、リンク先が無い種類では null */
  href: string | null;
};

/**
 * タイムラインに出す文言。**週次まとめのラベルとは別に持っている。**
 * あちらは「投稿 12」と件数に添える名詞、こちらは1件ずつ流す述語で、
 * 同じ文字列を使い回すとどちらかが不自然になる（`activityLog.ts` のコメント参照）。
 */
const TIMELINE_LABELS: Record<ActivityKind, string> = {
  "photo.created": "写真を投稿",
  "photo.deleted": "写真を削除",
  "photo.description_set": "説明を書いた",
  "photo.description_cleared": "説明を消した",
  "photo.reaction_added": "❤️を付けた",
  "photo.reaction_removed": "❤️を取り消した",
  "album.created": "アルバムを作成",
  "album.deleted": "アルバムを削除",
  "game.added": "ゲームを追加",
  "game.status_changed": "ステータスを変更",
  "game.removed": "ゲームを削除",
  "game.interest_added": "気になるを付けた",
  "game.interest_removed": "気になるを外した",
  "proposal.created": "ゲームを提案",
  "proposal.voted": "提案に投票",
  "proposal.vote_removed": "投票を取り消した",
  "proposal.accepted": "提案が通った",
  "proposal.withdrawn": "提案を取り下げた",
  "member.joined": "グループに参加",
};

/** detail から1行の補足を作る。**入っていない形は黙って捨てる**（表示のために例外を投げない） */
function noteOf(kind: string, detail: unknown): string | null {
  if (detail === null || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (kind === "game.status_changed" && typeof d.to === "string") {
    return typeof d.from === "string" ? `${d.from} → ${d.to}` : d.to;
  }
  if ((kind === "proposal.voted" || kind === "proposal.vote_removed") && typeof d.type === "string") {
    return d.type;
  }
  if (kind === "proposal.accepted" && typeof d.likeCount === "number") {
    return `👍 ${d.likeCount}`;
  }
  return null;
}

/** タイムラインの取得件数の上限。**上限なしにしない**（活発な日は1日で数百件になる） */
const TIMELINE_LIMIT = 60;

/**
 * タイムライン。`date`（JSTの `YYYY-MM-DD`）を渡すとその日ぶん、省略するとその月ぶん。
 *
 * **1年より古い日は空で返る。** 生ログを1年で消しているので、件数（カレンダー）は出せても
 * 1件ずつは出せない。呼ぶ側でそう表示すること（`CalendarDay.detailed`）。
 */
export async function getTimeline(
  groupId: string,
  opts: { date?: string | null; month?: string | null; limit?: number; now?: Date } = {}
): Promise<TimelineEntry[]> {
  const now = opts.now ?? new Date();
  const limit = Math.min(opts.limit ?? TIMELINE_LIMIT, TIMELINE_LIMIT);

  let period: { gte: Date; lt: Date };
  if (opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    const start = new Date(`${opts.date}T00:00:00.000+09:00`);
    period = { gte: start, lt: new Date(start.getTime() + DAY_MS) };
  } else {
    const range = jstMonthRange(opts.month, now);
    period = { gte: range.start, lt: range.end };
  }

  const logs = await db.activityLog.findMany({
    where: { groupId, occurredAt: period },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      targetId: true,
      targetName: true,
      actorId: true,
      occurredAt: true,
      createdAt: true,
      detail: true,
    },
  });
  if (logs.length === 0) return [];

  // **対象が今も在るかを確かめてからリンクにする。** ログには外部キーを張っていないので
  // （張ると削除の記録ごと消える）、消えた写真やアルバムのIDが普通に残っている。
  // 種類ごとにまとめて1クエリずつ引く（1件ずつ引くと本番では件数ぶん往復する）。
  const idsOf = (prefix: string) =>
    logs.filter((l) => l.kind.startsWith(prefix)).map((l) => l.targetId);

  const [actors, photos, albums, games, proposals] = await Promise.all([
    db.user.findMany({
      where: { id: { in: logs.map((l) => l.actorId).filter((id): id is string => id !== null) } },
      select: { id: true, name: true, email: true },
    }),
    db.photo.findMany({
      where: { id: { in: idsOf("photo.") } },
      select: { id: true, albumId: true },
    }),
    db.album.findMany({ where: { id: { in: idsOf("album.") } }, select: { id: true } }),
    db.groupGame.findMany({ where: { id: { in: idsOf("game.") } }, select: { id: true } }),
    db.groupGameProposal.findMany({
      where: { id: { in: idsOf("proposal.") } },
      select: { id: true },
    }),
  ]);

  const photoAlbum = new Map(photos.map((p) => [p.id, p.albumId]));
  const albumIds = new Set(albums.map((a) => a.id));
  const gameIds = new Set(games.map((g) => g.id));
  const proposalIds = new Set(proposals.map((p) => p.id));

  const hrefOf = (kind: string, targetId: string): string | null => {
    if (kind.startsWith("photo.")) {
      const albumId = photoAlbum.get(targetId);
      return albumId ? `/albums/${albumId}` : null; // 未分類の写真はアルバムが無い
    }
    if (kind.startsWith("album.")) return albumIds.has(targetId) ? `/albums/${targetId}` : null;
    if (kind.startsWith("game."))
      return gameIds.has(targetId) ? `/groups/${groupId}/games/${targetId}` : null;
    if (kind.startsWith("proposal."))
      return proposalIds.has(targetId) ? `/groups/${groupId}/proposals/${targetId}` : null;
    return null;
  };

  return logs.map((log) => {
    const actor = actors.find((u) => u.id === log.actorId);
    return {
      id: log.id,
      kind: log.kind,
      emoji: activityEmoji(log.kind),
      label: TIMELINE_LABELS[log.kind as ActivityKind] ?? log.kind,
      occurredAt: log.occurredAt,
      createdAt: log.createdAt,
      // 退会しても記録は残る。名前が引けないことと、そもそも人がいない経路（cron）は別物
      actorName: log.actorId ? (actor?.name ?? actor?.email ?? "（退会）") : null,
      targetName: log.targetName,
      note: noteOf(log.kind, log.detail),
      href: hrefOf(log.kind, log.targetId),
    };
  });
}
