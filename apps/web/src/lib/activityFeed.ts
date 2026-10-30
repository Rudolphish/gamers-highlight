import { db } from "./db";
import { activityEmoji, type ActivityKind } from "./activityLog";
import { RAW_LOG_RETENTION_DAYS } from "./activityRollup";
import { DAY_MS, JST_OFFSET_MS, dateColumnToString, jstDateColumn, jstDateString } from "./jst";
import { formatPlayDuration } from "./playDuration";
import { PROPOSAL_REACTION_LABELS, gameStatusLabel, proposalReactionLabel } from "./gameLabels";
import { getPlayCalendar, getRecentPlaysForGroups, type PlayCalendar, type PlayCalendarEntry } from "./playLog";

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

/**
 * **グループのメンバーには出さない種類**（取り消し・削除系。docs/play-log.md §11 の段階2、ユーザー判断）。
 * 管理画面だけに出す。グループ向けのカレンダーでは件数（マスの濃淡）からも外す。
 * アルバム・ゲームの削除と「ねらってる」（当時は「気になる」）を外したのは、実装後の画面で「アルバムを削除」が流れているのを見て足した（2026-10-18）
 */
export const GROUP_HIDDEN_KINDS: readonly ActivityKind[] = [
  "photo.deleted",
  "photo.reaction_removed",
  "photo.description_cleared",
  "proposal.vote_removed",
  "proposal.purchase_removed",
  "proposal.withdrawn",
  "album.deleted",
  "game.removed",
  "game.interest_removed",
];

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
  now = new Date(),
  opts: { excludeKinds?: readonly string[] } = {}
): Promise<MonthCalendar> {
  const kindFilter = opts.excludeKinds?.length ? { kind: { notIn: [...opts.excludeKinds] } } : {};
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
      where: { groupId, occurredAt: { gte: rawFrom, lt: range.end }, ...kindFilter },
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
        ...kindFilter,
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
  // 画面ではハートのアイコンが隣に出るので、文言には絵文字を入れない（デザイン刷新の段階2）
  "photo.reaction_added": "ハートを付けた",
  "photo.reaction_removed": "ハートを取り消した",
  "album.created": "アルバムを作成",
  "album.deleted": "アルバムを削除",
  "game.added": "ゲームを追加",
  "game.status_changed": "ステータスを変更",
  "game.removed": "ゲームを削除",
  "game.interest_added": "ねらってるを付けた",
  "game.interest_removed": "ねらってるを外した",
  "game.price_dropped": "最安値を更新",
  // グループ画面では「ゲーム提案」を「ウィッシュリスト」と呼ぶ（2026-10-18 ユーザー判断）。投票・採用は仕組みの言い方なので「提案」のまま
  "proposal.created": "ウィッシュリストに追加",
  "proposal.voted": "提案に投票",
  "proposal.vote_removed": "投票を取り消した",
  "proposal.agreed": "みんなでやりたいに上がった",
  "proposal.purchased": "買った",
  "proposal.purchase_removed": "買ったを取り消した",
  "proposal.accepted": "提案が通った",
  "proposal.withdrawn": "提案を取り下げた",
  "member.joined": "グループに参加",
};

/** 種類の短い説明（「写真を投稿」など）。画面でアイコンだけを並べる所の読み上げ用にも使う */
export function timelineLabel(kind: string): string {
  return TIMELINE_LABELS[kind as ActivityKind] ?? kind;
}

/** detail から1行の補足を作る。**入っていない形は黙って捨てる**（表示のために例外を投げない） */
function noteOf(kind: string, detail: unknown): string | null {
  if (detail === null || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  // 記録にはDBの値（WISHLIST・LIKE）が入っているので、画面の呼び方に直してから出す（以前はそのまま出ていた）
  if (kind === "game.status_changed" && typeof d.to === "string") {
    return typeof d.from === "string" ? `${gameStatusLabel(d.from)} → ${gameStatusLabel(d.to)}` : gameStatusLabel(d.to);
  }
  if ((kind === "proposal.voted" || kind === "proposal.vote_removed") && typeof d.type === "string") {
    return proposalReactionLabel(d.type);
  }
  // 2026-10-30 からは「全員が買った」で通るので購入の人数。それより前の記録は「やりたい」の人数
  if (kind === "proposal.accepted" && typeof d.purchasedCount === "number") {
    return `買った ${d.purchasedCount}人`;
  }
  if ((kind === "proposal.accepted" || kind === "proposal.agreed") && typeof d.likeCount === "number") {
    return `${PROPOSAL_REACTION_LABELS.LIKE} ${d.likeCount}人`;
  }
  if (kind === "game.price_dropped" && typeof d.price === "number") {
    return `¥${d.price.toLocaleString("ja-JP")}${typeof d.shop === "string" ? `（${d.shop}）` : ""}`;
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
  opts: { date?: string | null; month?: string | null; limit?: number; now?: Date; excludeKinds?: readonly string[] } = {}
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
    where: {
      groupId,
      occurredAt: period,
      ...(opts.excludeKinds?.length ? { kind: { notIn: [...opts.excludeKinds] } } : {}),
    },
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
      select: { id: true, name: true },
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
      // 退会しても記録は残る。名前が引けないことと、そもそも人がいない経路（cron）は別物。
      // **表示名が無い人をメールで出さない**（グループのメンバーにも見せるので。通知と同じ扱い）
      actorName: log.actorId ? (actor ? (actor.name ?? "メンバー") : "（退会）") : null,
      targetName: log.targetName,
      note: noteOf(log.kind, log.detail),
      href: hrefOf(log.kind, log.targetId),
    };
  });
}

/**
 * プレイ記録（`lib/playLog.ts` の `getPlayCalendar`）をタイムラインの行にする。1回1行、始まった時刻に置く。
 * 「Timberborn を 1時間26分」＋遊んだ人。進行中は「遊んでいる」、終わりが推定ならそう添える。
 */
export function playTimelineEntries(groupId: string, entries: PlayCalendarEntry[]): TimelineEntry[] {
  return entries.map((e) => ({
    id: `play:${e.id}`,
    kind: "play.session",
    emoji: "🎮",
    label: e.inProgress ? `${e.title} を遊んでいる` : `${e.title} を ${formatPlayDuration(e.durationMs)}`,
    occurredAt: e.startedAt,
    createdAt: e.startedAt,
    actorName: e.participants.length > 0 ? e.participants.join("・") : null,
    targetName: null,
    note: e.inProgress ? `いま ${formatPlayDuration(e.durationMs)}` : e.estimated ? "終わりは推定" : null,
    href: e.groupGameId ? `/groups/${groupId}/games/${e.groupGameId}` : null,
  }));
}

/** 出来事とプレイ記録を新しい順に混ぜる。件数の上限は `getTimeline` と同じ */
export function mergeTimeline(...lists: TimelineEntry[][]): TimelineEntry[] {
  return lists
    .flat()
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, TIMELINE_LIMIT);
}

/**
 * 活動カレンダー1か月ぶん（日のマス・プレイ記録・タイムライン）をまとめて読む。管理画面とグループの活動ページが使う。
 * `selectedDate` があればタイムラインはその日ぶん、無ければその月ぶん。グループ向けは `excludeKinds: GROUP_HIDDEN_KINDS` を渡す
 */
export async function loadActivityMonth(
  groupId: string,
  month: string,
  selectedDate: string | null,
  opts: { excludeKinds?: readonly string[]; now?: Date } = {}
): Promise<{ calendar: MonthCalendar; play: PlayCalendar; timeline: TimelineEntry[] }> {
  const now = opts.now ?? new Date();
  const calendar = await getMonthCalendar(groupId, month, now, { excludeKinds: opts.excludeKinds });
  const [events, play] = await Promise.all([
    getTimeline(groupId, { date: selectedDate, month, now, excludeKinds: opts.excludeKinds }),
    getPlayCalendar(groupId, calendar.range, now),
  ]);
  const playEntries = selectedDate ? play.entries.filter((e) => jstDateString(e.startedAt) === selectedDate) : play.entries;
  return { calendar, play, timeline: mergeTimeline(events, playTimelineEntries(groupId, playEntries)) };
}

export type RecentEntry = TimelineEntry & {
  /** どのグループの出来事か。ホームの「みんなの動き」（複数のグループを混ぜる）でだけ入れる */
  groupName: string | null;
};

export type RecentDay = {
  /** JSTの `YYYY-MM-DD` */
  date: string;
  /** 「今日」「昨日」「10/16（金）」 */
  label: string;
  entries: RecentEntry[];
};

/**
 * 「最近の動き」に出さない種類。取り消し系（`GROUP_HIDDEN_KINDS`）に加えて**ステータスの変更**。
 * 一覧の札を付け替えるたびに流れて、ほかの動きが押し出されていた（2026-10-21 ユーザー判断）。
 * カレンダー（/groups/[groupId]/activity）には今までどおり出す
 */
export const RECENT_HIDDEN_KINDS: readonly ActivityKind[] = [...GROUP_HIDDEN_KINDS, "game.status_changed"];

/** 写真のまとめで食われる分を見込んで、出す件数より多めに引く */
const RECENT_LOG_FETCH = 50;

/**
 * グループ画面の「最近の動き」（docs/play-log.md §11 の段階2）。出来事とプレイ記録を新しい順に `limit` 件。
 *
 * - **出来事は記録した時刻（`createdAt`）で並べる。** 写真の `occurredAt` は撮影日時なので、去年のスクショを今日上げると
 *   去年の位置に沈んで出てこない（週次まとめと同じ理由）。カレンダーは今までどおり `occurredAt`
 * - プレイ記録は始まった時刻で並べる
 * - **同じ人が続けて写真を投稿したら1行にまとめる**（「写真を7枚投稿」。ユーザー判断）。間に別の行が挟まる・日をまたぐと切る
 * - 取り消し系とステータスの変更（`RECENT_HIDDEN_KINDS`）は出さない
 * - キャッシュに載せない。出来事は Bot・各API・cron のどこからでも書かれるので、無効化を漏れなく入れるより毎回読む
 * - リンクはプレイ記録のゲームだけ（対象が残っているかを確かめる往復をグループ画面に足さない。詳しくは専用ページで見る）
 */
export async function getRecentActivity(groupId: string, limit = 5, now = new Date()): Promise<RecentDay[]> {
  return getRecentActivityForGroups([{ id: groupId, name: null }], limit, now);
}

/**
 * 複数のグループの「最近の動き」を混ぜて新しい順に `limit` 件（ホームの「みんなの動き」）。
 * 中身の決まりは `getRecentActivity` と同じ。`name` を渡したグループは各行に名前を添える。
 * **権限は判定しない**（呼ぶ側が、その人の所属するグループだけを渡す）
 */
export async function getRecentActivityForGroups(
  groups: { id: string; name: string | null }[],
  limit = 5,
  now = new Date()
): Promise<RecentDay[]> {
  if (groups.length === 0) return [];
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));
  const [logs, plays] = await Promise.all([
    db.activityLog.findMany({
      where: { groupId: { in: groups.map((g) => g.id) }, kind: { notIn: [...RECENT_HIDDEN_KINDS] } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LOG_FETCH,
      select: { id: true, kind: true, actorId: true, targetName: true, createdAt: true, groupId: true, detail: true },
    }),
    getRecentPlaysForGroups(groups.map((g) => g.id), limit, now),
  ]);
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];

  type Row = RecentEntry & { actorId: string | null; groupId: string | null; photos: number; games: Set<string | null> };
  const rows: Row[] = [
    ...logs.map((l) => {
      const actor = actors.find((u) => u.id === l.actorId);
      return {
        id: l.id,
        kind: l.kind,
        emoji: activityEmoji(l.kind),
        label: TIMELINE_LABELS[l.kind as ActivityKind] ?? l.kind,
        occurredAt: l.createdAt,
        createdAt: l.createdAt,
        actorName: l.actorId ? (actor ? (actor.name ?? "メンバー") : "（退会）") : null,
        targetName: l.targetName,
        // 値が要るのは最安値の更新だけ（どの値段になったか）。ほかの種類はグループ画面では補足を出してこなかった
        note: l.kind === "game.price_dropped" ? noteOf(l.kind, l.detail) : null,
        href: null,
        groupName: l.groupId ? (nameOf.get(l.groupId) ?? null) : null,
        actorId: l.actorId,
        groupId: l.groupId,
        photos: 1,
        games: new Set([l.targetName]),
      };
    }),
    ...plays.flatMap(({ groupId, entry }) =>
      playTimelineEntries(groupId, [entry]).map((e) => ({
        ...e,
        groupName: nameOf.get(groupId) ?? null,
        actorId: null,
        groupId,
        photos: 0,
        games: new Set<string | null>(),
      }))
    ),
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  // 新しい順に見て、直前の行が「同じ人の写真の投稿・同じグループ・同じ日」なら足し込む
  const merged: Row[] = [];
  for (const row of rows) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      row.kind === "photo.created" &&
      prev.kind === "photo.created" &&
      prev.actorId === row.actorId &&
      prev.groupId === row.groupId &&
      jstDateString(prev.occurredAt) === jstDateString(row.occurredAt)
    ) {
      prev.photos += 1;
      prev.games.add(row.targetName);
      continue;
    }
    if (merged.length === limit) break;
    merged.push(row);
  }

  const today = jstDateString(now);
  const yesterday = jstDateString(new Date(now.getTime() - DAY_MS));
  const days: RecentDay[] = [];
  for (const row of merged) {
    const { actorId: _actorId, groupId: _groupId, photos, games, ...entry } = row;
    if (photos > 1) {
      entry.label = `写真を${photos}枚投稿`;
      // まとめた写真のゲームが揃っているときだけゲーム名を添える
      entry.targetName = games.size === 1 ? [...games][0] : null;
    }
    const date = jstDateString(entry.occurredAt);
    let day = days[days.length - 1];
    if (!day || day.date !== date) {
      const jst = new Date(new Date(`${date}T00:00:00.000+09:00`).getTime() + JST_OFFSET_MS);
      const label =
        date === today
          ? "今日"
          : date === yesterday
            ? "昨日"
            : `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${WEEKDAYS[(jst.getUTCDay() + 6) % 7]}）`;
      day = { date, label, entries: [] };
      days.push(day);
    }
    day.entries.push(entry);
  }
  return days;
}
