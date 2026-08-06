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
