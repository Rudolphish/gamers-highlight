import { db } from "./db";

/** 使用量を記録している外部サービス。計測できるものだけを対象にしている（schema.prisma のApiUsage参照） */
export type TrackedService = "youtube";

/** YouTube Data APIの1日あたり無料枠（ユニット）。search.listは1回100消費する */
export const YOUTUBE_DAILY_QUOTA = 10_000;
export const YOUTUBE_SEARCH_UNITS = 100;

/** クォータのリセットに合わせ、UTCの日付でまとめる */
function utcDate(at = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * 外部APIを1回呼んだことを記録する。
 * 計測が本来の処理を妨げてはいけないので、失敗しても例外は投げない。
 */
export async function recordApiUsage(service: TrackedService, units: number): Promise<void> {
  try {
    const date = utcDate();
    await db.apiUsage.upsert({
      where: { service_date: { service, date } },
      create: { service, date, calls: 1, units },
      update: { calls: { increment: 1 }, units: { increment: units } },
    });
  } catch (e) {
    console.error(`[apiUsage] failed to record ${service}`, e);
  }
}

/** 今日ここまでに消費したユニット数。記録できていなければ0として扱う（計測で本処理を止めない） */
export async function usedUnitsToday(service: TrackedService): Promise<number> {
  try {
    const row = await db.apiUsage.findUnique({
      where: { service_date: { service, date: utcDate() } },
    });
    return row?.units ?? 0;
  } catch (e) {
    console.error(`[apiUsage] failed to read ${service}`, e);
    return 0;
  }
}

export type DailyUsage = { date: string; calls: number; units: number };

/** 直近days日ぶんの日別使用量を新しい順で返す */
export async function getDailyUsage(service: TrackedService, days = 30): Promise<DailyUsage[]> {
  const since = utcDate();
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const rows = await db.apiUsage.findMany({
    where: { service, date: { gte: since } },
    orderBy: { date: "desc" },
  });

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    calls: r.calls,
    units: r.units,
  }));
}
