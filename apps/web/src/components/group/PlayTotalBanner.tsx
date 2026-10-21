import Link from "next/link";
import { formatPlayDuration } from "@/lib/playDuration";

// グループ画面の頭に出す「グループで遊んだ時間」の帯（docs/play-log.md §13）。
// 5つの見本から「大きな帯」を選んだ（2026-10-17 ユーザー判断）。グループの看板として、
// 合計を大きく出し、下の1行に いちばん遊んだゲーム・ゲームの本数・最後に遊んだ日 を添える。
//
// **サーバーで描くので日付は必ず日本時間で整形する**（Vercelの実行環境はUTC。GroupPlayLogPanel と同じ）。

const dateFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });

export function PlayTotalBanner({
  groupId,
  totalMs,
  gameCount,
  topGame,
  lastPlayedAt,
  now = new Date(),
}: {
  groupId: string;
  totalMs: number;
  gameCount: number;
  topGame: { id: string; title: string } | null;
  lastPlayedAt: string | null;
  now?: Date;
}) {
  const last = lastPlayedAt ? new Date(lastPlayedAt) : null;
  const lastLabel = last ? (dayKey.format(last) === dayKey.format(now) ? "今日" : dateFmt.format(last)) : null;
  const [h, m] = [Math.floor(totalMs / 3600000), Math.floor((totalMs % 3600000) / 60000)];

  return (
    <section
      aria-label="グループで遊んだ時間"
      data-testid="play-total-banner"
      data-play-ms={totalMs}
      className="relative mt-5 overflow-hidden rounded border border-steam-border px-5 py-5 sm:px-6"
      style={{
        background:
          "radial-gradient(120% 140% at 100% 0%, rgba(90,176,234,0.22), transparent 60%), linear-gradient(120deg, #10202f, #1d3348 55%, #22324a)",
      }}
    >
      {/* 以前は「PLAYED TOGETHER ・ グループで遊んだ時間」。英語の飾りは外した（ユーザー判断） */}
      <p className="text-3xs tracking-[0.08em] text-steam-blue">グループで遊んだ時間</p>
      {/* 数字と単位を分けて描く。読み上げ用には「12時間34分」を1つの文字列で持たせる。
          **1280px以上は一段小さくする。** そこでは幅340pxの右の列に入るので、大きいままだと3桁時間（「119時間55分」）で
          「55分」が次の行へ落ちた（B143 で実測）。折り返さないよう nowrap も付けている */}
      <p
        className="mt-1 whitespace-nowrap font-display text-5xl font-bold leading-none text-[#eaf3fa] sm:text-6xl xl:text-5xl"
        aria-label={formatPlayDuration(totalMs)}
      >
        {h > 0 && (
          <>
            <span className="tabular-nums">{h}</span>
            <span className="mx-1 text-[0.45em] font-medium text-[#b9c9d6]">時間</span>
          </>
        )}
        <span className="tabular-nums">{m}</span>
        <span className="ml-1 text-[0.45em] font-medium text-[#b9c9d6]">分</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-3xs text-steam-text">
        {topGame && (
          <span>
            いちばん遊んだ{" "}
            <Link href={`/groups/${groupId}/games/${topGame.id}`} className="font-semibold text-steam-blue hover:underline">
              {topGame.title}
            </Link>
          </span>
        )}
        <span>{`ゲーム ${gameCount}本`}</span>
        {lastLabel && <span>{`最後に遊んだ日 ${lastLabel}`}</span>}
      </div>
    </section>
  );
}
