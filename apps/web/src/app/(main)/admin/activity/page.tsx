import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  getMonthCalendar,
  getTimeline,
  jstMonthRange,
  mergeTimeline,
  playTimelineEntries,
  shiftMonth,
  type MonthCalendar,
  type TimelineEntry,
} from "@/lib/activityFeed";
import { JST_OFFSET_MS, jstDateString } from "@/lib/jst";
import { getPlayCalendar, type PlayCalendar } from "@/lib/playLog";
import { formatPlayDuration, formatPlayDurationShort } from "@/lib/playDuration";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";

// 管理者ページ（活動カレンダー）：ActivityLog / DailyActivity を日付で見る。
//
// **まず管理者だけに出す。** 見せ方（濃淡の付け方・どの出来事を出すか・1日の粒度）は
// 実データを見ないと決まらないので、グループの画面に載せるのは調整が済んでから。
// データの取得は lib/activityFeed.ts に置いてあり、権限判定を通せばそのままグループ向けに使える。
//
// **カレンダーは occurredAt（実際に起きた日時）で並べる。** 週次まとめが createdAt で
// 数えるのと逆（docs/activity-log.md §9）。
//
// **プレイ記録（🎮）も載せる**（docs/play-log.md §11 の段階1）。ActivityLog には写さず GroupPlaySession を
// 直接読み、日のマスには件数と別に「🎮＋その日の合計時間」を出す（濃淡は今までどおり件数だけで付ける）。
export const dynamic = "force-dynamic";

const WEEKDAY_HEADS = ["月", "火", "水", "木", "金", "土", "日"];

/** 濃淡。件数そのものではなく「その月で一番多い日」を基準にする（グループの規模で薄くならないように） */
function cellTone(total: number, max: number): string {
  if (total === 0) return "border-steam-border bg-steam-panel text-steam-muted/50";
  const ratio = total / Math.max(max, 1);
  if (ratio > 0.66) return "border-[#a4d007]/60 bg-[#a4d007]/25 text-steam-text";
  if (ratio > 0.33) return "border-[#a4d007]/40 bg-[#a4d007]/15 text-steam-text";
  return "border-[#a4d007]/25 bg-[#a4d007]/8 text-steam-text";
}

/** JSTの時刻。サーバーのタイムゾーンに依存させない（lib/jst.ts と同じ考え方） */
function jstTime(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: { group?: string; month?: string; date?: string };
}) {
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
      calendar = await getMonthCalendar(groupId, month);
      const [events, played] = await Promise.all([
        getTimeline(groupId, { date: selectedDate, month }),
        getPlayCalendar(groupId, calendar.range),
      ]);
      play = played;
      const playEntries = selectedDate ? played.entries.filter((e) => jstDateString(e.startedAt) === selectedDate) : played.entries;
      timeline = mergeTimeline(events, playTimelineEntries(groupId, playEntries));
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

  const selectedDay = calendar?.days.find((d) => d.date === selectedDate) ?? null;
  const selectedPlay = selectedDate ? play.days[selectedDate] : undefined;
  const monthPlayMs = Object.values(play.days).reduce((sum, d) => sum + d.totalMs, 0);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">活動カレンダー</h1>
      <AdminNav />

      {error ? (
        <SectionError message={error} />
      ) : groups.length === 0 ? (
        <p className="mt-6 font-mono text-xs text-steam-muted">グループがまだありません。</p>
      ) : (
        calendar && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap gap-1">
                {groups.map((g) => (
                  <Link
                    key={g.id}
                    href={linkTo({ group: g.id, date: null })}
                    className={`rounded-sm border px-2.5 py-1.5 font-mono text-3xs ${
                      g.id === calendar.groupId
                        ? "border-steam-blue text-steam-blue"
                        : "border-steam-border text-steam-muted hover:text-steam-text"
                    }`}
                  >
                    {g.name}
                  </Link>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <Link
                  href={linkTo({ month: shiftMonth(month, -1), date: null })}
                  aria-label="前の月"
                  className="rounded-sm border border-steam-border p-1.5 text-steam-muted hover:text-steam-text"
                >
                  <ChevronLeft size={14} />
                </Link>
                <span className="min-w-[7rem] text-center font-mono text-xs text-steam-text">
                  {calendar.range.label}
                </span>
                <Link
                  href={linkTo({ month: shiftMonth(month, 1), date: null })}
                  aria-label="次の月"
                  className="rounded-sm border border-steam-border p-1.5 text-steam-muted hover:text-steam-text"
                >
                  <ChevronRight size={14} />
                </Link>
              </div>

              <p className="font-mono text-3xs text-steam-muted">
                この月の記録 {calendar.total} 件
                {monthPlayMs > 0 && ` ・ 🎮 ${formatPlayDuration(monthPlayMs)}`}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="rounded-sm border border-steam-border bg-steam-surface p-3 sm:p-4">
                <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
                  <CalendarDays size={12} /> {calendar.groupName}
                </h2>

                <div className="mt-3 grid grid-cols-7 gap-1">
                  {WEEKDAY_HEADS.map((w) => (
                    <div key={w} className="pb-1 text-center font-mono text-4xs text-steam-muted">
                      {w}
                    </div>
                  ))}
                  {/* 月初の曜日までを空けて、実際のカレンダーと同じ並びにする */}
                  {Array.from({ length: calendar.leadingBlanks }).map((_, i) => (
                    <div key={`blank-${i}`} />
                  ))}
                  {calendar.days.map((d) => (
                    <Link
                      key={d.date}
                      href={linkTo({ date: d.date === selectedDate ? null : d.date })}
                      className={`flex min-h-[3.5rem] flex-col rounded-sm border p-1 transition ${cellTone(
                        d.total,
                        calendar.max
                      )} ${d.date === selectedDate ? "outline outline-1 outline-steam-blue" : ""}`}
                    >
                      <span className="font-mono text-4xs">{d.day}</span>
                      {(d.total > 0 || play.days[d.date]) && (
                        <span className="mt-auto flex min-w-0 flex-col">
                          {d.total > 0 && (
                            <>
                              <span className="font-display text-sm font-bold leading-none">
                                {d.total}
                              </span>
                              <span className="truncate text-4xs leading-tight">
                                {d.counts
                                  .slice(0, 3)
                                  .map((c) => c.emoji)
                                  .join("")}
                              </span>
                            </>
                          )}
                          {/* 件数とは別に出す。出来事が0件でプレイだけの日もある（濃淡は件数だけで付けるので、色で目立たせる） */}
                          {play.days[d.date] && (
                            // 🎮と時間は折り返せるように分けている。スマホ幅（1マス34px前後）では「🎮2h44m」が1行に入らず、
                            // 切ると時間が読めなくなる。入る幅では1行、入らなければ🎮の下に時間が来る
                            <span
                              className="flex flex-wrap items-baseline font-mono text-4xs leading-tight text-steam-blue"
                              data-play-ms={play.days[d.date].totalMs}
                              title={formatPlayDuration(play.days[d.date].totalMs)}
                            >
                              <span>🎮</span>
                              <span>{formatPlayDurationShort(play.days[d.date].totalMs)}</span>
                            </span>
                          )}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>

                <p className="mt-3 font-mono text-4xs text-steam-muted/70">
                  数えているのは「実際に起きた日」（撮影日時が分かる写真はその日）。
                  {calendar.detailCutoff} より前は生ログを消してあるので、件数だけが残ります。
                </p>
              </section>

              <section className="rounded-sm border border-steam-border bg-steam-surface p-3 sm:p-4">
                <h2 className="font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
                  {selectedDay ? `${selectedDay.date}（${selectedDay.weekday}）` : "この月の記録"}
                </h2>

                {selectedDay && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedPlay && (
                      <span
                        className="rounded-sm border border-steam-blue/50 px-1.5 py-0.5 font-mono text-4xs text-steam-blue"
                        data-testid="day-play-total"
                        data-play-ms={selectedPlay.totalMs}
                      >
                        {`🎮 ${formatPlayDuration(selectedPlay.totalMs)}`}
                      </span>
                    )}
                    {selectedDay.counts.length === 0 ? (
                      !selectedPlay && <span className="font-mono text-3xs text-steam-muted">動きがありません</span>
                    ) : (
                      selectedDay.counts.map((c) => (
                        <span
                          key={c.kind}
                          className="rounded-sm border border-steam-border px-1.5 py-0.5 font-mono text-4xs text-steam-text"
                        >
                          {/* 1つの文字列にしている。JSXで並べるとReactが間にコメントを挟むので、
                              「📷 3」という見たままの文字列がHTMLに出なくなる（確認する側が読めない） */}
                          {`${c.emoji} ${c.count}`}
                        </span>
                      ))
                    )}
                  </div>
                )}

                {/* **件数は出るのに1件ずつが出ない日がある。** 生ログは1年で消すので、
                    古い日は集計しか残っていない。黙って空にすると壊れているように見える */}
                {selectedDay && !selectedDay.detailed && selectedDay.total > 0 && (
                  <p className="mt-3 rounded-sm border border-steam-border bg-steam-panel p-2 font-mono text-4xs text-steam-muted">
                    1年より前の日なので、1件ずつの記録は残っていません（件数のみ）。
                  </p>
                )}

                <ol className="mt-3 flex flex-col gap-2">
                  {timeline.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-start gap-2 border-b border-steam-border/50 pb-2 last:border-0"
                    >
                      <span className="shrink-0 text-xs leading-5">{e.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-3xs text-steam-text">
                          {e.label}
                          {e.note && <span className="ml-1 text-steam-muted">（{e.note}）</span>}
                        </p>
                        {e.targetName && (
                          <p className="truncate font-mono text-4xs text-steam-muted">
                            {e.targetName}
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-4xs text-steam-muted/70">
                          {/* 日を選んでいないときは日付も出す。**UTCの日付を出さないこと**（9時間ずれる） */}
                          {!selectedDay && `${jstDateString(e.occurredAt)} `}
                          {jstTime(e.occurredAt)}
                          {e.actorName && ` · ${e.actorName}`}
                        </p>
                      </div>
                      {e.href && (
                        <Link
                          href={e.href}
                          className="shrink-0 text-steam-muted hover:text-steam-blue"
                          aria-label="対象を開く"
                        >
                          <ExternalLink size={12} />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>

                {timeline.length === 0 && (
                  <p className="mt-3 font-mono text-3xs text-steam-muted">
                    表示できる記録がありません。
                  </p>
                )}
              </section>
            </div>
          </>
        )
      )}
    </main>
  );
}
