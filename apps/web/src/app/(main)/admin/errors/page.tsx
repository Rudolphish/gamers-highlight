import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { AlertTriangle } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { APP_SETTING_KEYS, getAppSetting } from "@/lib/appSettings";
import { formatRelativeTime } from "@/lib/relative-time";
import { AdminNav } from "@/components/admin/AdminNav";
import { ErrorNotifySetting } from "@/components/admin/ErrorNotifySetting";

const RECENT_LIMIT = 50;

// 管理者ページ（エラー）：画面で起きた例外の記録と、Discord通知先の設定。
//
// 友人に配ると、エラーが起きても本人からは報告されないまま黙って使われなくなる。
// Vercelのログは誰も見に行かないので、起きたことがこちらに届く経路を作る。
export const dynamic = "force-dynamic";

export default async function AdminErrorsPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const [channelId, reports] = await Promise.all([
    getAppSetting(APP_SETTING_KEYS.errorNotifyChannelId),
    db.errorReport.findMany({ orderBy: { lastSeenAt: "desc" }, take: RECENT_LIMIT }),
  ]);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">エラー</h1>
      <AdminNav />

      <ErrorNotifySetting channelId={channelId} />

      <div className="mt-6">
        <h2 className="font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
          最近のエラー（最大{RECENT_LIMIT}件）
        </h2>

        {reports.length === 0 ? (
          <p className="mt-3 font-mono text-sm text-steam-muted">
            記録されたエラーはありません。
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {reports.map((r) => (
              <div
                key={r.id}
                className="rounded-sm border border-steam-border bg-steam-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle size={12} className="flex-shrink-0 text-[#eb4b4b]" />
                  <code className="font-mono text-3xs text-steam-text">{r.path}</code>
                  {r.count > 1 && (
                    <span className="rounded-sm border border-[#e0a323]/50 px-1.5 py-0.5 font-mono text-4xs text-[#e0a323]">
                      {r.count}回
                    </span>
                  )}
                  <span className="ml-auto font-mono text-4xs text-steam-muted/70">
                    {formatRelativeTime(r.lastSeenAt)}
                  </span>
                </div>
                <p className="mt-1.5 break-words font-mono text-3xs text-steam-muted">
                  {r.message}
                </p>
                <p className="mt-1 font-mono text-4xs text-steam-muted/60">
                  初回: {r.firstSeenAt.toLocaleString("ja-JP")} ／{" "}
                  {r.notifiedAt
                    ? `通知済み: ${r.notifiedAt.toLocaleString("ja-JP")}`
                    : "未通知"}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 font-mono text-4xs text-steam-muted/70">
          本番のサーバー側エラーはNext.jsが内容を伏せるため、多くの場合メッセージは汎用的なものになり
          digest だけが手掛かりになります。それでも「いつ・どのページで・何回」は分かるので、
          Vercelのログをdigestで検索する入口として使えます。
          <br />
          同じ内容の通知は30分に1回までにまとめています（同じ不具合の連投でチャンネルが埋まらないように）。
        </p>
      </div>
    </main>
  );
}
