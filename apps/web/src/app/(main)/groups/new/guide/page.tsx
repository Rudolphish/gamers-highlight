import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";

// 新しいDiscordサーバーにBotを導入する手順ガイド。/groups/new から遷移してくる想定。
export default function DiscordBotGuidePage() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  // 権限: チャンネル閲覧(1024) + メッセージ送信(2048) + メッセージ履歴閲覧(65536) = 68608
  // scope: bot（サーバーに常駐） + applications.commands（/tagコマンドを使えるようにする）
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=68608&scope=bot+applications.commands`
    : null;

  const steps = [
    {
      title: "1. サーバーIDを控える",
      body: (
        <>
          Discordの「ユーザー設定」→「詳細設定」で<strong className="text-steam-text">開発者モード</strong>
          をONにする。その後、対象のサーバーアイコンを右クリック→「IDをコピー」で18〜19桁のIDが取得できる。
        </>
      ),
    },
    {
      title: "2. Botをそのサーバーに招待する",
      body: inviteUrl ? (
        <>
          下のボタンから招待リンクを開き、招待したいサーバーを選んで「認可」をクリックする。
          <br />
          <a
            href={inviteUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
          >
            <ExternalLink size={13} /> Botを招待する
          </a>
        </>
      ) : (
        <span className="text-[#eb4b4b]">
          招待リンクを生成できませんでした（DISCORD_CLIENT_IDが未設定です）
        </span>
      ),
    },
    {
      title: "3. グループを作成する",
      body: (
        <>
          <Link href="/groups/new" className="text-steam-blue hover:underline">
            グループ作成画面
          </Link>
          で、グループ名と1で控えたサーバーIDを入力して作成する。これでそのサーバーとグループが紐付く。
        </>
      ),
    },
    {
      title: "4. 動作確認",
      body: "招待したサーバーで、画像に「#ゲーム名」のようなハッシュタグを付けて投稿してみる。しばらくして、作成したグループの配下に自動でアルバムができていれば成功。",
    },
  ];

  return (
    <main className="p-4 sm:p-6">
      <Link
        href="/groups/new"
        className="mb-4 flex items-center gap-1 font-mono text-xs text-steam-muted"
      >
        <ChevronLeft size={14} /> 戻る
      </Link>

      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        新しいDiscordサーバーにBotを導入する
      </h1>
      <p className="mt-1 font-mono text-xs text-steam-muted">
        グループとDiscordサーバーを紐付けるための一連の手順
      </p>

      <div className="mt-6 flex max-w-2xl flex-col gap-4">
        {steps.map((step) => (
          <div key={step.title} className="rounded-sm border border-steam-border bg-steam-surface p-4">
            <h2 className="font-display font-semibold text-steam-text">{step.title}</h2>
            <p className="mt-2 font-mono text-xs leading-relaxed text-steam-muted">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 max-w-2xl rounded-sm border border-dashed border-steam-border bg-steam-surface p-4">
        <h2 className="font-display text-sm font-semibold text-steam-text">
          補足：後からタグを付け直す「/tag」コマンドについて
        </h2>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-steam-muted">
          「/tag game:ゲーム名」で直近の投稿にタグを付け直せる機能は、Bot管理者が
          サーバーごとに個別のコマンド登録作業（deploy-commands）を行う必要があります。
          複数サーバーで使いたい場合は、Bot管理者に相談してください
          （ハッシュタグによる自動取り込み自体は登録作業なしでどのサーバーでも動作します）。
        </p>
      </div>
    </main>
  );
}
