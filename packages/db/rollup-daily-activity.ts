/**
 * 活動ログの全期間を DailyActivity に集計し直す。**初回だけ手で流す。**
 *
 *   pnpm --filter @gamers-highlight/db rollup:all
 *
 * 日次cron（check-bot-health）は「直近に記録されたぶん」しか数え直さないので、
 * これを流さないと遡り投入した過去の日がヒートマップに出ない。
 * 何度流しても同じ結果になる（各日を置き換えるだけ）。
 *
 * 中身は apps/web の lib/activityRollup.ts と同じ考え方だが、
 * こちらは Prisma だけで完結させてある（Next.jsのモジュール解決を持ち込まないため）。
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstDateString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return [
    jst.getUTCFullYear(),
    String(jst.getUTCMonth() + 1).padStart(2, "0"),
    String(jst.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function main() {
  console.log("日次ロールアップ（全期間）を開始します");

  const all = await db.activityLog.findMany({
    where: { groupId: { not: null } },
    select: { groupId: true, occurredAt: true },
  });

  const targets = new Map<string, { groupId: string; dateString: string }>();
  for (const row of all) {
    if (!row.groupId) continue;
    const dateString = jstDateString(row.occurredAt);
    targets.set(`${row.groupId}/${dateString}`, { groupId: row.groupId, dateString });
  }
  console.log(`  対象: ${targets.size} 日ぶん（ログ ${all.length} 件から）`);

  let rows = 0;
  for (const { groupId, dateString } of targets.values()) {
    const start = new Date(`${dateString}T00:00:00.000+09:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const grouped = await db.activityLog.groupBy({
      by: ["kind"],
      where: { groupId, occurredAt: { gte: start, lt: end } },
      _count: { _all: true },
    });

    // @db.Date の切り捨てはUTCで行われるので、UTCの0時に置き直してから渡す
    // （JSTの0時のまま渡すと前日として保存される）
    const date = new Date(`${dateString}T00:00:00.000Z`);
    await db.$transaction([
      db.dailyActivity.deleteMany({ where: { groupId, date } }),
      ...(grouped.length === 0
        ? []
        : [
            db.dailyActivity.createMany({
              data: grouped.map((g) => ({ groupId, date, kind: g.kind, count: g._count._all })),
            }),
          ]),
    ]);
    rows += grouped.length;
  }

  const total = await db.dailyActivity.count();
  console.log(`完了。${targets.size} 日 / ${rows} 行を書き込み、DailyActivity は現在 ${total} 行です`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
