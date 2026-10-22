import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import { jstMonthRange, loadActivityMonth, type MonthCalendar, type TimelineEntry } from "@/lib/activityFeed";
import type { PlayCalendar } from "@/lib/playLog";
import { ActivityCalendarView } from "@/components/activity/ActivityCalendarView";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";

// 管理者ページ（活動カレンダー）：ActivityLog / DailyActivity を日付で見る。
//
// グループのメンバー向けは /groups/[groupId]/activity（同じ ActivityCalendarView を出す）。
// こちらは全グループを切り替えて見られ、取り消し系の出来事（写真の削除など）も出す。
//
// **カレンダーは occurredAt（実際に起きた日時）で並べる。** 週次まとめが createdAt で
// 数えるのと逆（docs/activity-log.md §9）。
//
// **プレイ記録（🎮）も載せる**（docs/play-log.md §11 の段階1）。ActivityLog には写さず GroupPlaySession を
// 直接読み、日のマスには件数と別に「🎮＋その日の合計時間」を出す（濃淡は今までどおり件数だけで付ける）。
export const dynamic = "force-dynamic";

export default async function AdminActivityPage(
  props: {
    searchParams: Promise<{ group?: string; month?: string; date?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  // 選んだ日が表示中の月の外なら無視する（前月へ動かしたときに選択が残ると噛み合わない）
  const month = jstMonthRange(searchParams.month).month;
  const selectedDate = searchParams.date?.startsWith(month) ? searchParams.date : null;

  // 取得に失敗してもページ全体は落とさない（/admin でテーブル未作成の500をやらかしている）
  let groups: { id: string; name: string }[] = [];
  let calendar: MonthCalendar | null = null;
  let timeline: TimelineEntry[] = [];
  let play: PlayCalendar = { days: {}, entries: [] };
  let error: string | null = null;
  try {
    groups = await db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    const groupId = groups.some((g) => g.id === searchParams.group)
      ? searchParams.group!
      : groups[0]?.id;
    if (groupId) {
      ({ calendar, play, timeline } = await loadActivityMonth(groupId, month, selectedDate));
    }
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  const linkTo = (params: { group?: string; month?: string; date?: string | null }) => {
    const q = new URLSearchParams();
    q.set("group", params.group ?? calendar?.groupId ?? "");
    q.set("month", params.month ?? month);
    const date = params.date === undefined ? selectedDate : params.date;
    if (date) q.set("date", date);
    return `/admin/activity?${q.toString()}`;
  };


  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">活動カレンダー</h1>
      <AdminNav />

      {error ? (
        <SectionError message={error} />
      ) : groups.length === 0 ? (
        <p className="mt-6 text-xs text-steam-muted">グループがまだありません。</p>
      ) : (
        calendar && (
          <>
            <ActivityCalendarView
              calendar={calendar}
              play={play}
              timeline={timeline}
              month={month}
              selectedDate={selectedDate}
              linkTo={linkTo}
              leading={
                <div className="flex flex-wrap gap-1">
                  {groups.map((g) => (
                    <Link
                      key={g.id}
                      href={linkTo({ group: g.id, date: null })}
                      className={`rounded-sm border px-2.5 py-1.5 text-3xs ${
                        g.id === calendar.groupId
                          ? "border-steam-blue text-steam-blue"
                          : "border-steam-border text-steam-muted hover:text-steam-text"
                      }`}
                    >
                      {g.name}
                    </Link>
                  ))}
                </div>
              }
            />
          </>
        )
      )}
    </main>
  );
}
