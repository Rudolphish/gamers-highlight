import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// Discord連携設定画面：アカウント連携状況の確認、未連携なら再ログイン導線
// 判定ロジックは /api/discord/link (GET) と同じ（user.discordUserIdの有無）。
// サーバーコンポーネントなので自前のAPIへフェッチせず、他画面と同様にdbを直接参照している。
export default async function DiscordSettingsPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;

  const linked = Boolean(user?.discordUserId);

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        Discord連携設定
      </h1>

      <div className="mt-6 max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
        {linked ? (
          <div className="flex items-center gap-2 font-mono text-sm text-steam-text">
            <CheckCircle2 size={16} className="flex-shrink-0 text-[#a4d007]" />
            Discordアカウントと連携済みです
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 font-mono text-sm text-[#eb4b4b]">
              <AlertCircle size={16} className="flex-shrink-0" />
              Discordアカウントが未連携です
            </div>
            <p className="mt-2 font-mono text-[11px] text-steam-muted">
              Discordの投稿を自動で取り込むには、Discordアカウントでのログインが必要です。
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-sm bg-[#5865F2] px-4 py-2 font-mono text-xs font-bold text-white"
            >
              Discordでログインし直す
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
