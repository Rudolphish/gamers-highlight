"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

type Section = { id: string; title: string; body: ReactNode };

export function ManualContent({ inviteUrl }: { inviteUrl: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);

  // /manual#discord-bot-invite のようなリンクで、該当セクションを開いた状態で表示する
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash) setOpenId(hash);
  }, []);

  const sections: Section[] = [
    {
      id: "discord-bot-invite",
      title: "新しいDiscordサーバーにBotを導入する",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            <strong className="text-steam-text">1. サーバーIDを控える</strong>
            <br />
            Discordの「ユーザー設定」→「詳細設定」で開発者モードをONにする。その後、対象のサーバーアイコンを右クリック→「IDをコピー」で18〜19桁のIDが取得できる。
          </p>
          <p>
            <strong className="text-steam-text">2. Botをそのサーバーに招待する</strong>
            <br />
            {inviteUrl ? (
              <a
                href={inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
              >
                <ExternalLink size={13} /> Botを招待する
              </a>
            ) : (
              <span className="text-[#eb4b4b]">招待リンクを生成できませんでした</span>
            )}
            <br />
            招待したいサーバーを選んで「認可」をクリックする。
          </p>
          <p>
            <strong className="text-steam-text">3. グループを作成する</strong>
            <br />
            <Link href="/groups/new" className="text-steam-blue hover:underline">
              グループ作成画面
            </Link>
            で、グループ名と1で控えたサーバーIDを入力して作成する。これでそのサーバーとグループが紐付く。
          </p>
          <p>
            <strong className="text-steam-text">4. 動作確認</strong>
            <br />
            招待したサーバーで、画像に「#ゲーム名」のようなハッシュタグを付けて投稿してみる。しばらくして、作成したグループの配下に自動でアルバムができていれば成功。
          </p>
          <p className="text-steam-muted/70">
            補足：「/tag」コマンド（後述）を使うには、Bot管理者がサーバーごとに個別のコマンド登録作業を行う必要があります。ハッシュタグによる自動取り込み自体は登録作業なしでどのサーバーでも動作します。
          </p>
        </div>
      ),
    },
    {
      id: "hashtag-auto-import",
      title: "ハッシュタグで自動取り込みする",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            Discordに投稿するメッセージ本文に「#ゲーム名」のようなハッシュタグを入れて、同じメッセージに画像/動画を添付すれば自動でタグ付けされます。例:
            <br />
            <span className="text-steam-text">#eldenring</span>
          </p>
          <p>
            そのタグが初めて使われた場合、自動でアルバムが作成されます（アルバム名はタグ名がそのまま使われます）。2回目以降、同じタグを付けて投稿すると同じアルバムに自動で振り分けられます。アルバム名は後から自由に変更できます。
          </p>
          <p>
            アルバム詳細ページの「タグ（ハッシュタグ別名）」機能で、「#elden_ring」のような表記ゆれを同じアルバムに統合することもできます。
          </p>
          <p className="text-steam-muted/70">
            注意：タグとして認識されるのは英数字と「_」のみです。スペースは区切り文字として扱われるので、「#Elden Ring」のように書くと「Elden」までしかタグとして拾われません。「#eldenring」や「#elden_ring」のように、スペース無しで書いてください。
          </p>
          <p className="text-steam-muted/70">
            ゲームごとにチャンネルを分けているサーバーなら、
            <Link href="/settings/channel-mapping" className="text-steam-blue hover:underline">
              設定 → チャンネル対応
            </Link>
            でチャンネルとゲームを紐付けておくと、ハッシュタグ無しでも自動で振り分けられます（ハッシュタグがある場合はそちらが優先されます）。
          </p>
        </div>
      ),
    },
    {
      id: "tag-command",
      title: "後からタグを付け直す（/tagコマンド）",
      body: (
        <p>
          ハッシュタグを付け忘れて投稿してしまった場合、Discordで「/tag game:ゲーム名」を実行すると、直近10分以内に自分が投稿した写真/動画にタグを付け直せます。それより古い投稿は、Web側のアルバム一覧→「未分類の投稿」から手動で振り分けてください。
        </p>
      ),
    },
    {
      id: "bot-asks-game",
      title: "ゲームが分からない投稿にBotが聞いてくる",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            ハッシュタグもチャンネル対応も無く、ファイル名からもゲームが分からない投稿には、Botが「どのゲームのスクショ？」と選択メニューで聞いてきます。選ばなくても投稿自体は保存されているので、無視しても構いません。
          </p>
          <p>
            <strong className="text-steam-text">候補に出るのは、グループのゲームリストで「プレイ中」になっているゲームだけです。</strong>
            候補に出したいゲームは、グループ画面のゲームリストからステータスを「プレイ中」にしておいてください。
          </p>
          <p>
            候補に無いゲームは「その他（入力する）」を選べば、名前で検索してその場で登録できます（アルバムも一緒に作られます）。
          </p>
          <p className="text-steam-muted/70">
            補足：クリップボードから貼り付けた画像にはファイル名の手掛かりが残らないため、この質問が出るのが普通の状態です。Steamのスクショフォルダから直接アップロードした場合は、ファイル名にゲームのIDが入っているので自動で判別されます。
          </p>
        </div>
      ),
    },
    {
      id: "group-games",
      title: "グループでゲームを共有する",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            グループ画面のゲームリストは、そのグループで話題になっているゲームを共有する場所です。各ゲームには「気になる」「プレイ中」「積みゲー」「クリア済み」のステータスを付けられます。
          </p>
          <p>
            <strong className="text-steam-text">開いた直後は「プレイ中」と「気になる」だけが表示されます。</strong>
            積みゲーやクリア済みも見たいときは、ステータスの並びの先頭にある「すべて」を押してください。
          </p>
          <p>
            ゲームカードの「気になる」ボタンは、ステータスとは別に「自分が狙っている」という印です。誰が狙っているかがカードに出るほか、ウィッシュリストの最安値がDiscordに通知されるときにも使われます。
          </p>
          <p>
            <strong className="text-steam-text">ゲーム提案</strong>：「このゲームどう？」と提案すると、メンバーがリアクションできます。「いいね」がメンバーの過半数に達すると、自動でゲームリストに「気になる」として追加されます。
          </p>
        </div>
      ),
    },
    {
      id: "game-detail",
      title: "ゲーム詳細で分かること",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            ゲームリストのカードから、そのゲームの詳細ページに入れます。Steamの価格・セール状況・レビュー評価・最新ニュース、全ストア横断の過去最安値、クリアまでの目安時間、関連動画がまとまっています。
          </p>
          <p>
            <strong className="text-steam-text">情報が出ていない項目があるとき</strong>
            ：クリア時間や関連動画は外部サービスから取っているため、追加したタイミングによっては取得できていないことがあります。ゲーム詳細ページの更新ボタンを押すと取り直せます。取れなかったサービス名はそのまま表示されるので、どこが落ちているか分かります。
          </p>
          <p className="text-steam-muted/70">
            補足：更新は連打できません（同じゲームにつき、全部揃っていれば24時間、まだ取れていない項目が残っていれば6時間の間隔が空きます）。外部サービスの呼び出し回数に上限があるためです。
          </p>
        </div>
      ),
    },
    {
      id: "invite-friend",
      title: "友達をグループに招待する",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            <strong className="text-steam-text">招待リンクを使う（おすすめ）</strong>
            <br />
            グループ画面の「招待リンク」から発行できます（グループのオーナーのみ）。相手はリンクを開いてDiscordでログインするだけで、アプリへのログインとグループ加入が一度に済みます。
          </p>
          <p>
            発行時に権限（閲覧者／編集者）、有効期限（24時間／72時間／7日）、使用できる回数を選べます。発行済みのリンクは一覧から取り消せます。
          </p>
          <p className="text-steam-muted/70">
            注意：このリンクは<strong className="text-steam-text">アプリへのログイン権限そのもの</strong>を渡すものです。回数は「リンクを踏んでログインした時点」で消費されます（グループ加入まで進まなくても消費されます）。渡す相手と回数には注意してください。
          </p>
          <p>
            <strong className="text-steam-text">既にログインしたことがある相手を招待する</strong>
            <br />
            グループ画面の「共有」から、登録済みユーザーを選んで招待できます。まだ一度もログインしたことがない相手はここに出てこないので、上の招待リンクを使ってください。
          </p>
        </div>
      ),
    },
    {
      id: "group-vs-album",
      title: "グループとアルバムの関係",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            「グループ」は複数の「アルバム」を束ねる上位単位です。基本的に1グループ＝1つのDiscordサーバーに対応します。
          </p>
          <p>
            グループに参加すると、配下の全アルバムを自動で閲覧できるようになります（VIEWER権限）。特定のアルバムだけ編集権限を渡したい場合は、アルバム詳細ページの「メンバー」から個別に招待できます。
          </p>
          <p>
            サイドバーの「アルバム」は所属グループを問わず全てのアルバムをフラットに一覧表示し、どのグループ所属かバッジで表示します。「グループ」からはグループ単位でまとまったアルバム一覧を見られます。
          </p>
        </div>
      ),
    },
    {
      id: "delete",
      title: "写真・アルバム・グループの削除",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            <strong className="text-steam-text">写真/動画</strong>：拡大表示（クリックして開く画面）右上のゴミ箱アイコンから削除できます。投稿者本人、またはそのアルバムのオーナーが削除可能です。
          </p>
          <p>
            <strong className="text-steam-text">アルバム</strong>：アルバム詳細ページの「削除」ボタンから削除できます（オーナーのみ）。中の写真/動画は削除されず、「未分類」として残ります。
          </p>
          <p>
            <strong className="text-steam-text">グループ</strong>：グループ詳細ページの「削除」ボタンから削除できます（オーナーのみ）。配下にアルバムが残っている場合は誤操作防止のため削除できません。先にアルバムを削除するか、別のグループへ移してください。
          </p>
        </div>
      ),
    },
    {
      id: "manual-upload",
      title: "手動アップロード",
      body: (
        <p>
          Discordを経由せず、サイドバーの「アップロード」から直接写真/動画を投稿することもできます。画像は15MBまで、動画は30MB・30秒までのファイルに対応しています（png/jpeg/webp、mp4/webm/mov）。
        </p>
      ),
    },
    {
      id: "search",
      title: "スクショを探す",
      body: (
        <p>
          サイドバーの「検索」から、ゲームタイトル・投稿者・投稿日の範囲で写真/動画を絞り込めます。自分が閲覧権限を持つアルバムの投稿のみが対象です。
        </p>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      {sections.map((s) => {
        const open = openId === s.id;
        return (
          <div key={s.id} id={s.id} className="rounded-sm border border-steam-border bg-steam-surface">
            <button
              onClick={() => setOpenId(open ? null : s.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="font-display font-semibold text-steam-text">{s.title}</span>
              <ChevronDown
                size={16}
                className={`flex-shrink-0 text-steam-muted transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && (
              <div className="border-t border-steam-border px-4 py-3 font-mono text-xs leading-relaxed text-steam-muted">
                {s.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
