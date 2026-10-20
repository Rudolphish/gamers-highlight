import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { shiftMonth, timelineLabel, type MonthCalendar, type TimelineEntry } from "@/lib/activityFeed";
import { ActivityIcon } from "@/components/activity/ActivityIcon";
import { JST_OFFSET_MS, jstDateString } from "@/lib/jst";
import type { PlayCalendar } from "@/lib/playLog";
import { formatPlayDuration, formatPlayDurationShort } from "@/lib/playDuration";

// 活動カレンダーの本体（月の切り替え・日のマス・選んだ日の内訳・タイムライン）。
// 管理画面（/admin/activity）とグループの活動ページ（/groups/[groupId]/activity）が同じものを出す。
// **権限はここでは判定しない**（呼ぶページ側で済ませてから渡す）。データの読み出しは lib/activityFeed.ts の loadActivityMonth。

const WEEKDAY_HEADS = ["月", "火", "水", "木", "金", "土", "日"];

/** 濃淡。件数そのものではなく「その月で一番多い日」を基準にする（グループの規模で薄くならないように） */
function cellTone(total: number, max: number): string {
  if (total === 0) return "border-steam-border bg-steam-panel text-steam-muted";
  const ratio = total / Math.max(max, 1);
  // 濃淡は目立たせる色（青）で付ける。緑は「お得・うまくいった」の意味に取ってある（デザイン刷新の段階1）
  if (ratio > 0.66) return "border-steam-blue/60 bg-steam-blue/25 text-steam-text";
  if (ratio > 0.33) return "border-steam-blue/40 bg-steam-blue/15 text-steam-text";
  return "border-steam-blue/25 bg-steam-blue/10 text-steam-text";
}

/** JSTの時刻。サーバーのタイムゾーンに依存させない（lib/jst.ts と同じ考え方） */
function jstTime(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export function ActivityCalendarView({
  calendar,
  play,
  timeline,
  month,
  selectedDate,
  linkTo,
  leading,
}: {
  calendar: MonthCalendar;
  play: PlayCalendar;
  timeline: TimelineEntry[];
  month: string;
  selectedDate: string | null;
  /** 月・日を動かすリンク先。`date: null` は選択を外す、省略は今の選択のまま */
  linkTo: (params: { month?: string; date?: string | null }) => string;
  /** 月の切り替えの前に置くもの（管理画面のグループ切り替え） */
  leading?: ReactNode;
}) {
  const selectedDay = calendar.days.find((d) => d.date === selectedDate) ?? null;
  const selectedPlay = selectedDate ? play.days[selectedDate] : undefined;
  const monthPlayMs = Object.values(play.days).reduce((sum, d) => sum + d.totalMs, 0);

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {leading}

        <div className="flex items-center gap-1">
          <Link
            href={linkTo({ month: shiftMonth(month, -1), date: null })}
            aria-label="前の月"
            className="rounded-sm border border-steam-border p-1.5 text-steam-muted hover:text-steam-text"
          >
            <ChevronLeft size={14} />
          </Link>
          <span className="min-w-[7rem] text-center text-xs text-steam-text">
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

        <p className="text-3xs text-steam-muted">
          この月の記録 {calendar.total} 件
          {monthPlayMs > 0 && (
            <span className="ml-1 inline-flex items-center gap-1" data-month-play-ms={monthPlayMs}>
              ・
              <ActivityIcon kind="play.session" size={13} className="text-steam-blue" />
              <span className="font-num">{formatPlayDuration(monthPlayMs)}</span>
            </span>
          )}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-xl bg-steam-surface p-3 sm:p-4">
          <h2 className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wide text-steam-muted">
            <CalendarDays size={12} /> {calendar.groupName}
          </h2>

          <div className="mt-3 grid grid-cols-7 gap-1">
            {WEEKDAY_HEADS.map((w) => (
              <div key={w} className="pb-1 text-center text-4xs text-steam-muted">
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
                <span className="font-num text-4xs">{d.day}</span>
                {(d.total > 0 || play.days[d.date]) && (
                  <span className="mt-auto flex min-w-0 flex-col">
                    {d.total > 0 && (
                      <>
                        <span className="font-num text-sm font-bold leading-none">
                          {d.total}
                        </span>
                        {/* 種類のアイコンを3つまで。何の種類かは選んだ日の内訳に文字で出る */}
                        <span className="flex gap-0.5 overflow-hidden text-steam-muted">
                          {d.counts.slice(0, 3).map((c) => (
                            <ActivityIcon key={c.kind} kind={c.kind} size={12} className="shrink-0" />
                          ))}
                        </span>
                      </>
                    )}
                    {/* 件数とは別に出す。出来事が0件でプレイだけの日もある（濃淡は件数だけで付けるので、色で目立たせる） */}
                    {play.days[d.date] && (
                      // 🎮・時間・分は折り返せるように分けている。スマホ幅（1マスの中身は34px前後）では「🎮2h44m」が1行に入らず、
                      // 切ると時間が読めなくなる。入る幅では1行、入らなければ🎮の下に時間、さらに入らなければ「2h」の下に「44m」が来る
                      // （文字を12pxに上げたとき「2h44m」だけで36pxになり、時間と分も分ける必要が出た）
                      <span
                        className="flex flex-wrap items-baseline font-num text-4xs leading-tight text-steam-blue"
                        data-play-ms={play.days[d.date].totalMs}
                        title={formatPlayDuration(play.days[d.date].totalMs)}
                      >
                        <ActivityIcon kind="play.session" size={12} className="mr-0.5 shrink-0 self-center" />
                        {formatPlayDurationShort(play.days[d.date].totalMs)
                          .split(/(?<=h)/)
                          .map((part) => (
                            <span key={part}>{part}</span>
                          ))}
                      </span>
                    )}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <p className="mt-3 text-4xs text-steam-muted">
            数えているのは「実際に起きた日」（撮影日時が分かる写真はその日）。
            {calendar.detailCutoff} より前は生ログを消してあるので、件数だけが残ります。
          </p>
        </section>

        <section className="rounded-xl bg-steam-surface p-3 sm:p-4">
          <h2 className="text-3xs font-bold uppercase tracking-wide text-steam-muted">
            {selectedDay ? `${selectedDay.date}（${selectedDay.weekday}）` : "この月の記録"}
          </h2>

          {selectedDay && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedPlay && (
                <span
                  className="rounded-sm border border-steam-blue/50 px-1.5 py-0.5 text-4xs text-steam-blue"
                  data-testid="day-play-total"
                  data-play-ms={selectedPlay.totalMs}
                >
                  <span className="inline-flex items-center gap-1">
                    <ActivityIcon kind="play.session" size={13} />
                    <span className="font-num">{formatPlayDuration(selectedPlay.totalMs)}</span>
                  </span>
                </span>
              )}
              {selectedDay.counts.length === 0 ? (
                !selectedPlay && <span className="text-3xs text-steam-muted">動きがありません</span>
              ) : (
                selectedDay.counts.map((c) => (
                  <span
                    key={c.kind}
                    className="inline-flex items-center gap-1 rounded-sm border border-steam-border px-1.5 py-0.5 text-4xs text-steam-text"
                    title={timelineLabel(c.kind)}
                    data-day-kind={c.kind}
                    data-count={c.count}
                  >
                    {/* 件数は属性（data-count）にも持たせている。JSXで並べるとReactが間にコメントを挟み、
                        見たままの文字列ではHTMLから拾えないため（確認する側はこちらを見る） */}
                    <ActivityIcon kind={c.kind} size={13} />
                    <span className="sr-only">{timelineLabel(c.kind)}</span>
                    <span className="font-num">{c.count}</span>
                  </span>
                ))
              )}
            </div>
          )}

          {/* **件数は出るのに1件ずつが出ない日がある。** 生ログは1年で消すので、
              古い日は集計しか残っていない。黙って空にすると壊れているように見える */}
          {selectedDay && !selectedDay.detailed && selectedDay.total > 0 && (
            <p className="mt-3 rounded-lg bg-steam-panel p-2 text-4xs text-steam-muted">
              1年より前の日なので、1件ずつの記録は残っていません（件数のみ）。
            </p>
          )}

          <ol className="mt-3 flex flex-col gap-2">
            {timeline.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 border-b border-steam-border/50 pb-2 last:border-0"
              >
                <ActivityIcon kind={e.kind} size={14} className="mt-0.5 shrink-0 text-steam-blue" />
                <div className="min-w-0 flex-1">
                  <p className="text-3xs text-steam-text">
                    {e.label}
                    {e.note && <span className="ml-1 text-steam-muted">（{e.note}）</span>}
                  </p>
                  {e.targetName && (
                    <p className="truncate text-4xs text-steam-muted">
                      {e.targetName}
                    </p>
                  )}
                  <p className="mt-0.5 text-4xs text-steam-muted">
                    {/* 日を選んでいないときは日付も出す。**UTCの日付を出さないこと**（9時間ずれる） */}
                    {!selectedDay && `${jstDateString(e.occurredAt)} `}
                    <span className="font-num">{jstTime(e.occurredAt)}</span>
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
            <p className="mt-3 text-3xs text-steam-muted">
              表示できる記録がありません。
            </p>
          )}
        </section>
      </div>
    </>
  );
}
