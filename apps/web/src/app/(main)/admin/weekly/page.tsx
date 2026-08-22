import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { CalendarDays } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  formatWeeklySummaryText,
  getWeeklySummary,
  jstWeekRange,
  type WeeklySummary,
} from "@/lib/weeklySummary";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";
import { WeeklyNotifySetting } from "@/components/admin/WeeklyNotifySetting";
import { APP_SETTING_KEYS, getAppSetting } from "@/lib/appSettings";

// 管理者ページ（週次まとめ）：Discordへ流す文面を、送る前にここで確認する。
//
// **通知を先に作らなかったのは、確認に1週間かかるため。** cronは週1回しか動かないので、
// 文面を調整するたびに次の日曜まで待つことになる。ここなら期間を選んで即座に見られる。
//
// 表示している文面は formatWeeklySummaryText の出力そのもので、通知もこれを送る。
// 別々に組み立てると、ここで整えた文面と実際に飛ぶ文面がずれる。
export const dynamic = "force-dynamic";

/** 選べる週。0が今週。通知は「終わった週」を送るので既定は先週にしてある */
const WEEK_CHOICES = [
  { offset: 0, label: "今週" },
  { offset: -1, label: "先週" },
  { offset: -2, label: "2週前" },
  { offset: -3, label: "3週前" },
];

function parseWeek(raw: string | undefined): number {
  const n = Number(raw);
  return WEEK_CHOICES.some((w) => w.offset === n) ? n : -1;
}

export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: { group?: string; week?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const week = parseWeek(searchParams.week);

  // 集計に失敗してもページ全体は落とさない（/admin でテーブル未作成の500をやらかしている）
  let groups: { id: string; name: string }[] = [];
  let summary: WeeklySummary | null = null;
  let notifyChannelId: string | null = null;
  let error: string | null = null;
  try {
    notifyChannelId = await getAppSetting(APP_SETTING_KEYS.weeklySummaryChannelId);
    groups = await db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    const groupId = groups.some((g) => g.id === searchParams.group)
      ? searchParams.group!
      : groups[0]?.id;
    if (groupId) summary = await getWeeklySummary(groupId, week);
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  const linkTo = (params: { group?: string; week?: number }) => {
    const q = new URLSearchParams();
    q.set("group", params.group ?? summary?.groupId ?? "");
    q.set("week", String(params.week ?? week));
    return `/admin/weekly?${q.toString()}`;
  };

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">週次まとめ</h1>
      <AdminNav />

      {error ? (
        <SectionError message={error} />
      ) : groups.length === 0 ? (
        <p className="mt-6 font-mono text-xs text-steam-muted">グループがまだありません。</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-1">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={linkTo({ group: g.id })}
                  className={`rounded-sm border px-2.5 py-1.5 font-mono text-3xs ${
                    g.id === summary?.groupId
                      ? "border-steam-blue text-steam-blue"
                      : "border-steam-border text-steam-muted hover:text-steam-text"
                  }`}
                >
                  {g.name}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEK_CHOICES.map((w) => (
                <Link
                  key={w.offset}
                  href={linkTo({ week: w.offset })}
                  className={`rounded-sm border px-2.5 py-1.5 font-mono text-3xs ${
                    w.offset === week
                      ? "border-steam-blue text-steam-blue"
                      : "border-steam-border text-steam-muted hover:text-steam-text"
                  }`}
                >
                  {w.label}
                  <span className="ml-1 text-steam-muted">{jstWeekRange(w.offset).label}</span>
                </Link>
              ))}
            </div>
          </div>

          <WeeklyNotifySetting
            channelId={notifyChannelId}
            week={week}
            weekLabel={jstWeekRange(week).label}
          />

          {summary && (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
                <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
                  <CalendarDays size={12} /> 内訳（{summary.range.label}）
                </h2>

                <dl className="mt-4 grid grid-cols-3 gap-3">
                  {summary.counts.map((c) => (
                    <div key={c.kind} className="rounded-sm border border-steam-border p-2.5">
                      <dt className="font-mono text-4xs text-steam-muted">
                        {c.emoji} {c.label}
                      </dt>
                      <dd
                        className={`mt-1 font-display text-xl font-bold ${
                          c.count > 0 ? "text-steam-text" : "text-steam-muted"
                        }`}
                      >
                        {c.count}
                      </dd>
                    </div>
                  ))}
                </dl>

                {summary.completedGames.length > 0 && (
                  <p className="mt-4 font-mono text-xs text-steam-text">
                    🏆 クリア: {summary.completedGames.join("、")}
                  </p>
                )}
                {summary.topPosters.length > 0 && (
                  <p className="mt-2 font-mono text-xs text-steam-muted">
                    📷 よく上げた人:{" "}
                    {summary.topPosters.map((p) => `${p.name}（${p.count}）`).join("、")}
                  </p>
                )}
                {summary.topPhoto && (
                  <p className="mt-2 font-mono text-xs text-steam-muted">
                    ❤️ いちばん反応があった写真: {summary.topPhoto.title ?? "（ゲーム名なし）"}（
                    {summary.topPhoto.reactions}件）
                    {summary.topPhoto.albumId && (
                      <Link
                        href={`/albums/${summary.topPhoto.albumId}`}
                        className="ml-2 text-steam-blue hover:underline"
                      >
                        アルバムを開く
                      </Link>
                    )}
                  </p>
                )}
              </section>

              <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
                <h2 className="font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
                  Discordに送る文面
                </h2>
                <p className="mt-1 font-mono text-4xs text-steam-muted">
                  実際に送るのはこの文字列そのもの。まだ送信はしていない
                </p>

                {/* 0件の週は「送らない」という判断をここで見えるようにする。
                    毎週鳴ると読み飛ばされ、本当に見てほしい週に効かなくなるため */}
                {!summary.hasActivity && (
                  <p className="mt-3 rounded-sm border border-steam-border bg-steam-panel p-2.5 font-mono text-3xs text-steam-muted">
                    この週は動きがないので、通知は送らない扱いになります。
                  </p>
                )}

                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-steam-border bg-steam-panel p-3 font-mono text-xs text-steam-text">
                  {formatWeeklySummaryText(summary)}
                </pre>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
