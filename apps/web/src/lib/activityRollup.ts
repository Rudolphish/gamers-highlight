import { db } from "./db";
import { DAY_MS, jstDateColumn, jstDateString, jstDayRange } from "./jst";

/**
 * 活動ログの日次ロールアップと、保持期間を過ぎた生ログの掃除。
 * 設計は docs/activity-log.md §8。日次cron（check-bot-health）から呼ばれる。
 *
 * 役割は2つ。
 *   1. `ActivityLog` を「グループ×日×種類の件数」に畳んで `DailyActivity` に置く（**永久に残す**）
 *   2. 1年より古い `ActivityLog` を消す（生ログは1年で捨てる）
 *
 * **1を先にやってから2をやる。** 逆にすると、集計する前に元が消える。
 *
 * ここが見るのは「直近に記録されたぶん」だけ。**過去の全期間を集計し直すのは
 * `packages/db/rollup-daily-activity.ts`（`pnpm --filter @gamers-highlight/db rollup:all`）**で、
 * 遡り投入した後に1回だけ手で流す。同じ処理をこちらにも置くと、片方だけ直る事故が起きる。
 */

/** 生ログの保持期間。これを過ぎた行は消える（件数は DailyActivity に残る） */
export const RAW_LOG_RETENTION_DAYS = 365;

/**
 * 「最近記録されたぶん」として数え直す範囲。
 *
 * **前日ぶんだけを集計するのでは足りない。** ロールアップは `occurredAt`（実際に起きた日）で
 * 数えるので、去年撮ったスクショを今日上げると **去年のその日**の件数が増える。
 * 「昨日」を集計するだけでは、その1件がヒートマップに永久に出ない。
 *
 * そこで「直近に**記録された**（createdAt）ログが触れている日」を数え直す形にした。
 * cronが1日飛んでも次回に埋まるよう、1日ではなく3日ぶんを見る。
 */
const RECOUNT_WINDOW_DAYS = 3;

export type MaintenanceResult = {
  /** 数え直した (グループ, 日) の数 */
  recountedDays: number;
  /** 書き込んだ DailyActivity の行数 */
  writtenRows: number;
  /** 消した生ログの行数 */
  deletedLogs: number;
  /** 消えたグループのぶんとして片付けた集計の行数 */
  deletedOrphanRollups: number;
  /** 保持期間の境界。これより古い createdAt の行が消える */
  cutoff: Date;
};

/**
 * 1日ぶん（1グループ）を数え直して `DailyActivity` に置き直す。
 *
 * **足し込みではなく置き換え。** 足し込みだと、cronが二重に走ったときに件数が倍になる。
 * 置き換えなら何度流しても同じ結果になる。
 */
async function recountDay(groupId: string, dateString: string): Promise<number> {
  const { start, end } = jstDayRange(dateString);

  const grouped = await db.activityLog.groupBy({
    by: ["kind"],
    where: { groupId, occurredAt: { gte: start, lt: end } },
    _count: { _all: true },
  });

  const date = jstDateColumn(dateString);
  await db.$transaction([
    db.dailyActivity.deleteMany({ where: { groupId, date } }),
    ...(grouped.length === 0
      ? []
      : [
          db.dailyActivity.createMany({
            data: grouped.map((g) => ({
              groupId,
              date,
              kind: g.kind,
              count: g._count._all,
            })),
          }),
        ]),
  ]);

  return grouped.length;
}

/**
 * 日次の手入れ。cronから呼ぶ。
 *
 * **数え直すのは保持期間内の日だけ。** 保持期間を過ぎた日は生ログがもう無いので、
 * 数え直すと0になり、永久に残すはずの件数を自分で壊す。
 * （境界より古い `occurredAt` を持つのに `createdAt` が新しい行——つまり
 * 「1年以上前の出来事を今日記録した」もの——はこの数え直しから漏れるが、
 * 写真の `capturedAt` は未来日を弾いており、そこまで古い取り込みは想定していない。
 * 漏れても生ログ側には残るので、カレンダーの日別表示では読める。）
 */
export async function runActivityMaintenance(now = new Date()): Promise<MaintenanceResult> {
  const cutoff = new Date(now.getTime() - RAW_LOG_RETENTION_DAYS * DAY_MS);

  // 1) 直近に記録されたログが触れている (グループ, 日) を集める
  const since = new Date(now.getTime() - RECOUNT_WINDOW_DAYS * DAY_MS);
  const touched = await db.activityLog.findMany({
    where: { createdAt: { gte: since }, groupId: { not: null } },
    select: { groupId: true, occurredAt: true },
  });

  const targets = new Map<string, { groupId: string; dateString: string }>();
  for (const row of touched) {
    if (!row.groupId) continue;
    if (row.occurredAt < cutoff) continue; // 保持期間を過ぎた日は触らない（上のコメント参照）
    const dateString = jstDateString(row.occurredAt);
    targets.set(`${row.groupId}/${dateString}`, { groupId: row.groupId, dateString });
  }

  let writtenRows = 0;
  for (const { groupId, dateString } of targets.values()) {
    writtenRows += await recountDay(groupId, dateString);
  }

  // 2) 集計し終えてから、保持期間を過ぎた生ログを消す
  const deleted = await db.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });

  // 3) 消えたグループぶんの集計を片付ける。
  //
  // **DailyActivity は永久に残す方針なので、放っておくと孤児が永久に残る。**
  // 生ログの方は1年で消えるが、こちらには期限が無い。
  // 外部キーを張っていないのは ActivityLog と揃えたため（グループの寿命に
  // 集計を巻き込ませない）で、そのぶん自分で片付ける。
  const groupIds = (await db.group.findMany({ select: { id: true } })).map((g) => g.id);
  const orphans = await db.dailyActivity.deleteMany({ where: { groupId: { notIn: groupIds } } });

  return {
    recountedDays: targets.size,
    writtenRows,
    deletedLogs: deleted.count,
    deletedOrphanRollups: orphans.count,
    cutoff,
  };
}
