import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { JST_OFFSET_MS } from "@/lib/jst";
import { formatPlayDuration } from "@/lib/playLogNotify";
import { listAdminGroupOptions, listAdminPlaySessions, type AdminGroupOption } from "@/lib/playLogAdmin";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";
import { AdminAddPlaySessionButton, AdminPlaySessionActions } from "@/components/admin/AdminPlaySessionEditor";

// 管理者ページ（プレイ記録）：Bot が付けたプレイ記録を直す。時間の修正・削除・記録されなかった回の手動追加。
//
// **管理者だけ**（2026-10-17 ユーザー判断）。Bot が落ちていた・VC に入らずに遊んだ・オンライン状態を
// 隠している人しかいなかった、などで記録が欠けたり時間がずれたりしたときに、後から直すための場所。
// 設計は docs/play-log.md §12、処理は lib/playLogAdmin.ts。
export const dynamic = "force-dynamic";

/** JSTの「10/17(土) 21:05」。サーバーのタイムゾーンに依存させない */
function jstLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd}) ${hm}`;
}

export default async function AdminPlayLogPage({ searchParams }: { searchParams: { group?: string; page?: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  let groups: AdminGroupOption[] = [];
  let listed: Awaited<ReturnType<typeof listAdminPlaySessions>> | null = null;
  let error: string | null = null;
  try {
    groups = await listAdminGroupOptions();
    const groupId = groups.some((g) => g.id === searchParams.group) ? searchParams.group! : null;
    listed = await listAdminPlaySessions({ groupId, page: Number(searchParams.page) || 1 });
  } catch (e) {
    // 取得に失敗してもページ全体は落とさない（/admin でテーブル未作成の500をやらかしている）
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  const groupId = groups.some((g) => g.id === searchParams.group) ? searchParams.group! : null;
  const linkTo = (p: { group?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const g = p.group === undefined ? groupId : p.group;
    if (g) q.set("group", g);
    if (p.page && p.page > 1) q.set("page", String(p.page));
    const s = q.toString();
    return s ? `/admin/play-log?${s}` : "/admin/play-log";
  };

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">プレイ記録</h1>
      <AdminNav />

      {error || !listed ? (
        <SectionError message={error ?? "読み込めませんでした"} />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              <Link
                href={linkTo({ group: null })}
                className={`rounded-sm border px-2.5 py-1.5 font-mono text-3xs ${groupId === null ? "border-steam-blue text-steam-blue" : "border-steam-border text-steam-muted hover:text-steam-text"}`}
              >
                すべて
              </Link>
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={linkTo({ group: g.id })}
                  className={`rounded-sm border px-2.5 py-1.5 font-mono text-3xs ${g.id === groupId ? "border-steam-blue text-steam-blue" : "border-steam-border text-steam-muted hover:text-steam-text"}`}
                >
                  {g.name}
                </Link>
              ))}
            </div>
            <AdminAddPlaySessionButton groups={groups} defaultGroupId={groupId} />
          </div>

          <p className="mt-3 font-mono text-3xs text-steam-muted">
            {`${listed.total} 件 ・ 進行中の記録は、終わってから直せます ・ 時刻は日本時間`}
          </p>

          {listed.sessions.length === 0 ? (
            <p className="mt-6 font-mono text-xs text-steam-muted">プレイ記録はまだありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {listed.sessions.map((s) => {
                const durationMs = s.endedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : null;
                return (
                  <li key={s.id} data-play-session={s.id} className="rounded-sm border border-steam-border bg-steam-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-sm font-semibold text-steam-text">
                          {s.title}
                          {!s.groupGameId && <span className="ml-2 font-mono text-4xs text-[#d9a441]">ゲーム未結びつき</span>}
                          {s.manual && <span className="ml-2 font-mono text-4xs text-steam-blue">手動で追加</span>}
                          {s.estimated && <span className="ml-2 font-mono text-4xs text-steam-muted">終わりは推定</span>}
                        </p>
                        <p className="mt-0.5 font-mono text-3xs text-steam-muted">
                          {`${s.groupName} ・ ${jstLabel(s.startedAt)} 〜 ${s.endedAt ? jstLabel(s.endedAt) : "進行中"}`}
                          {durationMs !== null && ` ・ ${formatPlayDuration(durationMs)}`}
                        </p>
                        <p className="mt-0.5 font-mono text-3xs text-steam-text">
                          {`参加: ${s.participants.map((p) => p.name).join("、") || "（なし）"}`}
                        </p>
                      </div>
                      <AdminPlaySessionActions session={s} groups={groups} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {listed.pageCount > 1 && (
            <div className="mt-4 flex items-center gap-3 font-mono text-3xs">
              {listed.page > 1 && (
                <Link href={linkTo({ page: listed.page - 1 })} className="text-steam-blue">
                  ← 新しい方へ
                </Link>
              )}
              <span className="text-steam-muted">{`${listed.page} / ${listed.pageCount}`}</span>
              {listed.page < listed.pageCount && (
                <Link href={linkTo({ page: listed.page + 1 })} className="text-steam-blue">
                  古い方へ →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
