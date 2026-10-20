import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { RecentDay } from "@/lib/activityFeed";
import { ActivityIcon } from "@/components/activity/ActivityIcon";
import { JST_OFFSET_MS } from "@/lib/jst";

// グループ画面の「最近の動き」（docs/play-log.md §11 の段階2。見本4案から C をユーザーが選んだ）。
// 新しい順に5件、日ごとの見出しで区切る。それより前と月のカレンダーは /groups/[groupId]/activity で見る。
// 中身の組み立て（並べる時刻・写真のまとめ・取り消し系を外す）は lib/activityFeed.ts の getRecentActivity。

/** JSTの時刻。サーバーのタイムゾーンに依存させない */
function jstTime(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export function RecentActivity({ groupId, days }: { groupId: string; days: RecentDay[] }) {
  return (
    <section aria-label="最近の動き" data-testid="recent-activity" className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-steam-text">最近の動き</h2>
        <Link href={`/groups/${groupId}/activity`} className="text-xs text-steam-blue hover:underline">
          カレンダーで見る →
        </Link>
      </div>
      <ol className="mt-3 rounded-xl bg-steam-surface">
        {days.map((day) => (
          <li key={day.date} className="px-3 pb-1 pt-2.5">
            <p className="text-3xs font-bold text-steam-muted">{day.label}</p>
            <ol className="mt-1.5">
              {day.entries.map((e) => {
                const play = e.kind === "play.session";
                // 補足は1つの文字列にする（JSXで並べると間にコメントが挟まり、見たままの文字列でHTMLを確かめられない）
                const meta = [jstTime(e.occurredAt), e.actorName, e.note, play ? null : e.targetName].filter(Boolean).join(" · ");
                return (
                  <li key={e.id} data-kind={e.kind} className="flex items-start gap-2.5 border-t border-steam-border/50 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-steam-panel text-steam-blue">
                      <ActivityIcon kind={e.kind} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-5 ${play ? "font-medium text-steam-blue" : "text-steam-text"}`}>{e.label}</p>
                      <p className="mt-0.5 truncate text-4xs text-steam-muted">{meta}</p>
                    </div>
                    {e.href && (
                      <Link href={e.href} aria-label={`${e.label} を開く`} className="shrink-0 p-1 text-steam-muted hover:text-steam-blue">
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}
