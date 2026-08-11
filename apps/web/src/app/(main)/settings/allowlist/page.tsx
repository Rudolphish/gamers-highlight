import { getServerSession } from "next-auth";
import { AlertCircle } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail, isAdminConfigured } from "@/lib/admin";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AllowlistManager } from "@/components/settings/AllowlistManager";

// 許可リスト設定画面：このアプリにログインできる人を管理する（管理者のみ）。
// 従来は packages/db/seed-allowlist.ts の書き換え＋実行、または Prisma Studio しか手段が無かった。
export default async function AllowlistSettingsPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminEmail(session?.user?.email);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">許可リスト</h1>
      <SettingsNav />

      <p className="mt-4 font-mono text-xs text-steam-muted">
        ここに登録された人だけがサインインできます。登録されていないアカウントはログイン画面で弾かれます。
      </p>

      {isAdmin ? (
        <AllowlistManager />
      ) : (
        <div className="mt-6 flex max-w-2xl items-start gap-2 rounded-sm border border-steam-border bg-steam-surface p-4 font-mono text-xs text-steam-muted">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-[#e0a323]" />
          {isAdminConfigured() ? (
            <span>この画面を操作できるのは管理者のみです。</span>
          ) : (
            <span>
              管理者が設定されていません。環境変数 <code className="text-steam-text">ADMIN_EMAILS</code>{" "}
              に管理者のメールアドレス（カンマ区切り）を設定すると、この画面から許可リストを編集できます。
            </span>
          )}
        </div>
      )}
    </main>
  );
}
