import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { GROUP_HIDDEN_KINDS, jstMonthRange, loadActivityMonth } from "@/lib/activityFeed";
import { ActivityCalendarView } from "@/components/activity/ActivityCalendarView";

// グループの活動カレンダー（docs/play-log.md §11 の段階2）。グループ画面の「最近の動き」の「カレンダーで見る」から開く。
//
// 中身は管理画面（/admin/activity）と同じ ActivityCalendarView。違いは、
// - **このグループだけ**（グループの切り替えは出さない）
// - **取り消し系の出来事は出さない**（写真の削除・❤️の取り消し等。件数からも外す。ユーザー判断）
//
// **権限はページ側で判定する**（CLAUDE.md「ページはAPIの権限判定を通らない」）。権限が無ければ存在ごと伏せて404。
// 配下の loading.tsx のせいで、notFound() でもステータスは200のまま本文だけが差し替わる（CLAUDE.md）。
export const dynamic = "force-dynamic";

export default async function GroupActivityPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { month?: string; date?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) notFound();
  const allowed = await hasGroupPermission(params.groupId, currentUser.id, "VIEWER");
  if (!allowed) notFound();

  const group = await db.group.findUnique({ where: { id: params.groupId }, select: { id: true, name: true } });
  if (!group) notFound();

  // 選んだ日が表示中の月の外なら無視する（前月へ動かしたときに選択が残ると噛み合わない）
  const month = jstMonthRange(searchParams.month).month;
  const selectedDate = searchParams.date?.startsWith(month) ? searchParams.date : null;
  const data = await loadActivityMonth(group.id, month, selectedDate, { excludeKinds: GROUP_HIDDEN_KINDS }).catch((e) => {
    console.error("[activity] load failed", e);
    return null;
  });

  const linkTo = (p: { month?: string; date?: string | null }) => {
    const q = new URLSearchParams();
    q.set("month", p.month ?? month);
    const date = p.date === undefined ? selectedDate : p.date;
    if (date) q.set("date", date);
    return `/groups/${group.id}/activity?${q.toString()}`;
  };

  return (
    <main className="p-4 sm:p-6">
      <Link
        href={`/groups/${group.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={14} /> {group.name}に戻る
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-steam-text sm:text-3xl">活動カレンダー</h1>

      {data ? (
        <ActivityCalendarView {...data} month={month} selectedDate={selectedDate} linkTo={linkTo} />
      ) : (
        <p className="mt-6 text-xs text-steam-muted">活動の記録を読み込めませんでした。時間をおいて開き直してください。</p>
      )}
    </main>
  );
}
