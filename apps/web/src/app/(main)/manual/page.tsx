import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { ManualContent } from "@/components/manual/ManualContent";

// マニュアル画面：使い方をトピックごとにアコーディオンで解説する
export default async function ManualPage() {
  // 管理者向けの項目を出すかどうかだけに使う（権限の判定ではない。管理ページ自体はそれぞれ isAdminEmail で守っている）
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminEmail(session?.user?.email);
  const clientId = process.env.DISCORD_CLIENT_ID;
  // 権限: チャンネル閲覧(1024) + メッセージ送信(2048) + メッセージ履歴閲覧(65536) = 68608
  // scope: bot（サーバーに常駐） + applications.commands（/tagコマンドを使えるようにする）
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=68608&scope=bot+applications.commands`
    : null;

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">マニュアル</h1>
      <p className="mt-1 text-xs text-steam-muted">
        使い方を分類ごとにまとめています。トピックはタップで開閉できます
      </p>

      <div className="mt-6 max-w-2xl">
        <ManualContent inviteUrl={inviteUrl} isAdmin={isAdmin} />
      </div>
    </main>
  );
}
