import { Gamepad2 } from "lucide-react";
import type { GamePlaySummary } from "@/lib/playLog";
import { formatPlayDuration } from "@/lib/playDuration";

// グループで一緒に遊んだ時間（プレイ記録）。設計は docs/play-log.md。
//
// **サーバーで描くので時刻は必ず日本時間で整形する**（Vercelの実行環境はUTC。
// timeZone を付けないと夜の記録が前日・9時間前に出る）。

const TIME_ZONE = "Asia/Tokyo";

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/** 「2時間30分」「45分」。1分未満は「1分未満」（表記は lib/playDuration.ts に1つだけ置く） */
const formatDuration = formatPlayDuration;

export function GroupPlayLogPanel({ summary }: { summary: GamePlaySummary }) {
  return (
    <div
      className="rounded-xl bg-steam-surface p-4 sm:p-6"
      data-testid="group-play-log"
    >
      <h2 className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <Gamepad2 size={12} /> グループで遊んだ時間
      </h2>

      {summary.totalMs === 0 ? (
        <p className="mt-3 text-xs text-steam-muted">
          まだ記録がありません。DiscordのVCで2人以上がこのゲームを遊ぶと、自動で記録されます。
        </p>
      ) : (
        <>
          <p className="mt-3 font-num text-2xl font-bold text-steam-text" data-testid="group-play-total" data-play-ms={summary.totalMs}>
            {formatDuration(summary.totalMs)}
          </p>
          {summary.lastPlayedAt && (
            <p className="mt-0.5 text-3xs text-steam-muted">
              最後に遊んだ日: {dateFmt.format(new Date(summary.lastPlayedAt))}
            </p>
          )}

          {summary.recent.length > 0 && (
            // 縦に伸びないよう枠の中でスクロールさせる（ユーザー判断）。高さはおよそ5回ぶん
            <ul
              className="mt-4 flex max-h-72 flex-col divide-y divide-steam-border overflow-y-auto overscroll-contain pr-1"
              data-testid="group-play-sessions"
            >
              {summary.recent.map((s) => {
                const start = new Date(s.startedAt);
                const end = new Date(start.getTime() + s.durationMs);
                return (
                  <li key={s.id} className="py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-xs text-steam-text">
                        {dateFmt.format(start)} {timeFmt.format(start)}〜{s.inProgress ? "" : timeFmt.format(end)}
                      </span>
                      <span className="text-xs font-bold text-steam-text">
                        {s.inProgress ? `プレイ中（${formatDuration(s.durationMs)}）` : formatDuration(s.durationMs)}
                        {s.estimated && (
                          <span
                            className="ml-1.5 rounded-sm border border-steam-border px-1 font-normal text-steam-muted"
                            title="Botが止まっていた間を含むため、時刻は推定です"
                          >
                            推定
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-3xs text-steam-muted">{s.participants.join("・")}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-4xs text-steam-muted">
            5分未満の記録は一覧に出していません（合計には含みます）。
          </p>
        </>
      )}
    </div>
  );
}
