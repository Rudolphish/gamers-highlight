import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { Film, Image as ImageIcon, Users } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { formatBytes } from "@/lib/adminStats";
import { getUserActivity, parseSortKey, type SortKey } from "@/lib/userStats";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";

// 管理者ページ（ユーザー一覧）：誰がどのグループに所属し、どれだけ投稿しているかを見る。
// 「登録はしたが使っていない人」がどれくらいいるかを把握するのが主目的。
export const dynamic = "force-dynamic";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "posts", label: "投稿数" },
  { key: "recent", label: "最終投稿" },
  { key: "joined", label: "登録日" },
  { key: "name", label: "名前" },
];

const ROLE_LABEL: Record<string, string> = {
  OWNER: "オーナー",
  EDITOR: "編集者",
  VIEWER: "閲覧者",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { sort?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const sort = parseSortKey(searchParams.sort);

  // 集計に失敗してもページ全体を落とさない（/admin で一度やらかしている）
  let data: Awaited<ReturnType<typeof getUserActivity>> | null = null;
  let error: string | null = null;
  try {
    data = await getUserActivity(sort);
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  const activeRate =
    data && data.summary.totalUsers > 0
      ? Math.round((data.summary.activeUsers / data.summary.totalUsers) * 100)
      : 0;

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">ユーザー一覧</h1>
      <AdminNav />

      {error || !data ? (
        <div className="mt-4">
          <SectionError message={error ?? "集計できませんでした。"} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="登録ユーザー" value={data.summary.totalUsers.toLocaleString()} />
            <Stat
              label={`直近${data.summary.windowDays}日に投稿`}
              value={`${data.summary.activeUsers.toLocaleString()}人`}
              sub={`${activeRate}%`}
            />
            <Stat
              label="一度も投稿なし"
              value={`${data.summary.neverPosted.toLocaleString()}人`}
            />
            <Stat
              label="投稿の総数"
              value={data.rows.reduce((n, r) => n + r.total, 0).toLocaleString()}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-4xs uppercase tracking-wide text-steam-muted">
              並べ替え
            </span>
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={s.key === "posts" ? "/admin/users" : `/admin/users?sort=${s.key}`}
                className={`rounded-sm border px-2 py-1 font-mono text-3xs transition ${
                  sort === s.key
                    ? "border-steam-blue text-steam-blue"
                    : "border-steam-border text-steam-muted hover:border-steam-blue"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <p className="mt-6 font-mono text-sm text-steam-muted">ユーザーがいません。</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-sm border border-steam-border">
              <table className="w-full min-w-[820px] border-collapse">
                <thead>
                  <tr className="bg-steam-panel text-left font-mono text-4xs uppercase tracking-wide text-steam-muted">
                    <th className="px-3 py-2">ユーザー</th>
                    <th className="px-3 py-2">所属グループ</th>
                    <th className="px-3 py-2 text-right">画像</th>
                    <th className="px-3 py-2 text-right">動画</th>
                    <th className="px-3 py-2 text-right">合計</th>
                    <th className="px-3 py-2 text-right">容量</th>
                    <th className="px-3 py-2">最終投稿</th>
                    <th className="px-3 py-2">登録日</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-steam-border bg-steam-surface align-top"
                    >
                      <td className="max-w-[180px] px-3 py-2">
                        <p className="truncate font-mono text-3xs text-steam-text">
                          {u.name ?? "(名前なし)"}
                        </p>
                        <p className="truncate font-mono text-4xs text-steam-muted/70">
                          {u.email ?? "-"}
                        </p>
                      </td>

                      <td className="max-w-[260px] px-3 py-2">
                        {u.groups.length === 0 ? (
                          <span className="font-mono text-4xs text-steam-muted/60">
                            所属なし
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.groups.map((g) => (
                              <Link
                                key={`${u.id}-${g.id}`}
                                href={`/groups/${g.id}`}
                                title={ROLE_LABEL[g.role] ?? g.role}
                                className="rounded-sm border border-steam-border px-1.5 py-0.5 font-mono text-4xs text-steam-muted hover:border-steam-blue hover:text-steam-blue"
                              >
                                {g.name}
                                <span className="ml-1 text-steam-muted/60">
                                  {ROLE_LABEL[g.role] ?? g.role}
                                </span>
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 text-right font-mono text-3xs text-steam-muted">
                        <span className="inline-flex items-center gap-1">
                          <ImageIcon size={11} className="text-steam-blue/70" />
                          {u.images.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-3xs text-steam-muted">
                        <span className="inline-flex items-center gap-1">
                          <Film size={11} className="text-steam-blue/70" />
                          {u.videos.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-3xs font-bold text-steam-text">
                        {u.total.toLocaleString()}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-3xs text-steam-muted">
                        {u.knownBytes > 0 ? formatBytes(u.knownBytes) : "-"}
                        {/* Discord経由の投稿はサイズを持たないので、合計は下限でしかない */}
                        {u.unknownSizeCount > 0 && (
                          <span
                            className="ml-1 text-steam-muted/60"
                            title={`${u.unknownSizeCount}件はサイズが記録されていません（Discord経由の投稿など）`}
                          >
                            +{u.unknownSizeCount}件不明
                          </span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 font-mono text-3xs text-steam-muted/70">
                        {u.lastPostedAt ? (
                          u.lastPostedAt.toLocaleDateString("ja-JP")
                        ) : (
                          <span className="text-steam-muted/50">なし</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-3xs text-steam-muted/70">
                        {u.createdAt.toLocaleDateString("ja-JP")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 flex items-start gap-1.5 font-mono text-4xs text-steam-muted/70">
            <Users size={11} className="mt-0.5 shrink-0" />
            容量はサイズが記録されている投稿の合計です。Discord経由で取り込んだ投稿は
            サイズを持たないことがあるため、実際の使用量はこれより大きくなります。
            バケット全体の実測値は「使用量」タブで見られます。
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-sm border border-steam-border bg-steam-surface p-3">
      <p className="font-mono text-4xs uppercase tracking-wide text-steam-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-steam-text">
        {value}
        {sub && <span className="ml-1.5 font-mono text-xs text-steam-blue">{sub}</span>}
      </p>
    </div>
  );
}
