import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { ShieldAlert } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getInviteAudit, STATUS_LABEL, type InviteStatus } from "@/lib/inviteAudit";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";
import { RevokeInviteButton } from "@/components/admin/RevokeInviteButton";

// 管理者ページ（招待リンク）：全グループの招待リンクを横断して見る。
//
// 招待リンクはグループのオーナーしか見られないので、これが無いと
// 「いま誰がどのグループに人を呼べる状態か」をアプリ全体で把握できない。
// 許可リストへの入口である以上、オーナー任せにはしない。
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "オーナー",
  EDITOR: "編集者",
  VIEWER: "閲覧者",
};

const STATUS_CLASS: Record<InviteStatus, string> = {
  active: "text-[#a4d007]",
  "used-up": "text-steam-muted",
  expired: "text-steam-muted/60",
  revoked: "text-steam-muted/60",
};

export default async function AdminInvitesPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  let data: Awaited<ReturnType<typeof getInviteAudit>> | null = null;
  let error: string | null = null;
  try {
    data = await getInviteAudit();
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">招待リンク</h1>
      <AdminNav />

      {error || !data ? (
        <div className="mt-4">
          <SectionError message={error ?? "取得できませんでした。"} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="発行されたリンク" value={data.summary.total.toLocaleString()} />
            <Stat label="いま有効" value={`${data.summary.active.toLocaleString()}本`} />
            <Stat
              label="未加入のまま権限あり"
              value={`${data.summary.pendingAccess.toLocaleString()}人`}
              alert={data.summary.pendingAccess > 0}
            />
            <Stat
              label={`直近${data.summary.windowDays}日の参加`}
              value={`${data.summary.recentJoins.toLocaleString()}人`}
            />
          </div>

          {data.summary.pendingAccess > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-sm border border-[#eb4b4b]/40 bg-steam-panel p-3 font-mono text-4xs text-steam-muted">
              <ShieldAlert size={12} className="mt-0.5 shrink-0 text-[#eb4b4b]" />
              リンクを踏んでログインしたが、まだグループに加入していない人が
              {data.summary.pendingAccess}人います。この人たちは許可リストに載っているため、
              グループには入っていなくてもアプリにはログインできます。心当たりが無ければ、
              該当のリンクを取り消してください（取り消すとこの権限も一緒に消えます）。
            </p>
          )}

          {data.rows.length === 0 ? (
            <p className="mt-6 font-mono text-sm text-steam-muted">
              発行された招待リンクはありません。
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-sm border border-steam-border">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="bg-steam-panel text-left font-mono text-4xs uppercase tracking-wide text-steam-muted">
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2">グループ</th>
                    <th className="px-3 py-2">発行者</th>
                    <th className="px-3 py-2">権限</th>
                    <th className="px-3 py-2 text-right">使用</th>
                    <th className="px-3 py-2 text-right">未加入</th>
                    <th className="px-3 py-2">参加した人</th>
                    <th className="px-3 py-2">有効期限</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((i) => (
                    <tr
                      key={i.id}
                      className="border-t border-steam-border bg-steam-surface align-top"
                    >
                      <td
                        className={`whitespace-nowrap px-3 py-2 font-mono text-3xs ${STATUS_CLASS[i.status]}`}
                      >
                        {STATUS_LABEL[i.status]}
                      </td>
                      <td className="max-w-[160px] px-3 py-2">
                        <Link
                          href={`/groups/${i.groupId}`}
                          className="block truncate font-mono text-3xs text-steam-text hover:text-steam-blue"
                        >
                          {i.groupName}
                        </Link>
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-3xs text-steam-muted">
                        {i.issuer}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-3xs text-steam-muted">
                        {ROLE_LABEL[i.role] ?? i.role}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-3xs text-steam-muted">
                        {i.usedCount}/{i.maxUses}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-3xs">
                        {i.pendingAccess > 0 ? (
                          <span
                            className="text-[#eb4b4b]"
                            title="リンクからログインしたが、まだグループに加入していない人数"
                          >
                            {i.pendingAccess}人
                          </span>
                        ) : (
                          <span className="text-steam-muted/50">-</span>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2 font-mono text-4xs text-steam-muted/70">
                        {i.joined.length === 0
                          ? "-"
                          : i.joined
                              .map(
                                (j) =>
                                  `${j.name}（${j.usedAt.toLocaleDateString("ja-JP")}）`
                              )
                              .join("、")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-4xs text-steam-muted/70">
                        {i.expiresAt.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!i.revokedAt && (
                          <RevokeInviteButton
                            inviteId={i.id}
                            groupName={i.groupName}
                            pendingAccess={i.pendingAccess}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div
      className={`rounded-sm border bg-steam-surface p-3 ${
        alert ? "border-[#eb4b4b]/40" : "border-steam-border"
      }`}
    >
      <p className="font-mono text-4xs uppercase tracking-wide text-steam-muted">{label}</p>
      <p
        className={`mt-1 font-display text-xl font-bold ${
          alert ? "text-[#eb4b4b]" : "text-steam-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
