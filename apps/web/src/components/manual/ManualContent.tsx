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
          ハッシュタグを付け忘れて投稿してしまった場合、Discordで「/tag game:ゲーム名」を実行すると、直近10分以内に自分が投稿した写真/動画にタグを付け直せます。それより古い投稿は、下の「未分類の投稿を振り分ける」の手順で振り分けてください。
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
      id: "unclassified",
      title: "未分類の投稿を振り分ける",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            ゲームが決まらなかった投稿は「未分類」として残ります。サイドバーの
            <strong className="text-steam-text">「アルバム」</strong>
            を開くと、未分類が1件でもあれば上部にカードが出るので、そこから振り分け画面に入れます。
          </p>
          <p>
            写真をタップして選び（まとめて選べます）、
            <strong className="text-steam-text">グループを選んでから</strong>
            アルバムを選びます。グループを先に選ぶのは、別のグループに同じ名前のアルバムがあると
            取り違えるためです。アルバムがまだ無ければ、その場で名前を入れて新しく作れます。
          </p>
          <p>
            入れたいグループがまだ無いときは、選択欄の下にある「新しいグループを作る」から作成できます。
          </p>
          <p className="text-steam-muted/70">
            補足：Botが落ちていた間の投稿も、Botが起動したときにまとめて取り込まれます。
            そのぶんはゲームを聞かれないので、ここから振り分けてください。
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
      id: "price-notify",
      title: "セール・最安値をDiscordに通知する",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            ウィッシュリスト（ゲームリストで「気になる」ステータスのゲーム）の価格を毎日調べて、
            <strong className="text-steam-text">過去の最安値を更新したときだけ</strong>
            Discordに通知します。値下げのたびに鳴るわけではありません。
          </p>
          <p>
            <strong className="text-steam-text">通知先の設定が必要です。</strong>
            グループ画面のグループ名の下にある「通知先」から、投稿したいチャンネルを選んでください
            （グループのオーナーだけが設定できます）。
            <strong className="text-steam-text">設定するまで通知は一切飛びません。</strong>
          </p>
          <p>
            通知には、そのゲームに「気になる」を付けているメンバーの名前も添えられます。
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
      id: "permissions",
      title: "権限（オーナー／編集者／閲覧者）でできること",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            グループに招待されると、既定では<strong className="text-steam-text">閲覧者</strong>
            として入ります。閲覧者でも投稿・❤️・説明はできます——「見るだけ」ではありません。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-steam-border">
                  <th className="py-1.5 pr-3 font-normal text-steam-muted">できること</th>
                  <th className="py-1.5 font-normal text-steam-muted">必要な権限</th>
                </tr>
              </thead>
              <tbody className="text-steam-text">
                {[
                  ["写真を見る・投稿する", "閲覧者"],
                  ["❤️を付ける・説明を書く", "閲覧者"],
                  ["ゲームを提案する・提案に投票する・「気になる」を付ける", "閲覧者"],
                  ["ゲームリストへの追加・ステータス変更・削除", "編集者"],
                  ["アルバムを作る・アルバム名や説明を編集する", "編集者"],
                  ["写真を削除する", "投稿した本人、またはアルバムのオーナー"],
                  ["アルバムの削除・メンバー管理・サムネイル設定", "アルバムのオーナー"],
                  ["グループのメンバー管理・招待リンクの発行・グループの削除", "グループのオーナー"],
                ].map(([what, role]) => (
                  <tr key={what} className="border-b border-steam-border/40 last:border-0">
                    <td className="py-1.5 pr-3">{what}</td>
                    <td className="py-1.5 whitespace-nowrap text-steam-muted">{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-steam-muted/70">
            補足：グループの権限は配下の全アルバムに効きます。特定のアルバムだけ強い権限を渡したいときは、
            アルバム詳細の「共有」から個別に招待してください。
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
        <div className="flex flex-col gap-3">
          <p>
            Discordを経由せず、サイドバーの「アップロード」から直接写真/動画を投稿することもできます。画像は15MBまで、動画は30MB・30秒までのファイルに対応しています（png/jpeg/webp、mp4/webm/mov）。
          </p>
          <p>
            <strong className="text-steam-text">Steamのスクショはゲームを自動で判別します。</strong>
            Steamのスクショフォルダから選んだファイルは、ファイル名にゲームのIDが入っているため、
            該当するアルバムが自動で選ばれます（「〇〇 のアルバム『△△』に追加します」と出ます）。
            クリップボードから貼り付けた画像には手掛かりが残らないので、その場合は下で指定してください。
          </p>
          <p>
            追加先は<strong className="text-steam-text">グループを選んでからアルバムを選びます</strong>。
            別のグループに同じ名前のアルバムがあっても取り違えないようにするためです。
            グループがまだ無いときは「新しいグループを作る」から作成できます（別のタブで開くので、
            選んだファイルは消えません。作成後にアップロード画面を再読み込みしてください）。
          </p>
          <p>
            アルバムを選ばなくても投稿できます。その場合は「未分類」に入るので、後から振り分けてください。
          </p>
        </div>
      ),
    },
    {
      id: "reactions-description",
      title: "❤️と説明（コメント）を付ける",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            写真をタップして開く拡大表示で、<strong className="text-steam-text">❤️</strong>
            を付けられます。1人1回で、もう一度押すと取り消せます。グリッドの一覧にも数が出ます。
          </p>
          <p>
            <strong className="text-steam-text">説明</strong>は1枚につき1つ書けます。
            「コメント」のように積み上がるものではなく、
            <strong className="text-steam-text">そのアルバムを見られる人なら誰でも書き換えられる</strong>
            メモです（最後に書いた人の名前と日時が出ます）。検索の対象にも入ります。
          </p>
          <p className="text-steam-muted/70">
            注意：<strong className="text-steam-text">未分類の投稿には❤️も説明も付けられません。</strong>
            どのアルバムにも入っていないと「誰が触ってよいか」を決められないためです。
            先にアルバムへ振り分けてください。
          </p>
        </div>
      ),
    },
    {
      id: "album-view",
      title: "アルバムの並び順とサムネイル",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            アルバムの一覧は<strong className="text-steam-text">更新順・新着順・名前順・写真の多い順</strong>
            で並べ替えられます。既定は更新順で、
            <strong className="text-steam-text">そのアルバムに投稿があると上に来ます</strong>。
          </p>
          <p>
            グループ画面では最初の4件だけ表示され、「さらに表示」で増やせます
            （下のゲームリストや提案が押し出されないようにするためです）。
          </p>
          <p>
            <strong className="text-steam-text">サムネイル</strong>は、アルバム詳細の
            Steamアイコンのボタンからゲームを検索して設定できます（アルバムのオーナーのみ）。
            同じ画面から、そのゲームをグループのゲームリストに追加することもできます。
            設定しない場合は、いちばん新しい投稿がサムネイルになります。
          </p>
          <p className="text-steam-muted/70">
            補足：1つのグループにアルバムが100件を超えると、更新の古いものは一覧に読み込まれません
            （その場合は画面にその旨が出ます）。
          </p>
        </div>
      ),
    },
    {
      id: "search",
      title: "スクショを探す",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            サイドバーの「検索」から、
            <strong className="text-steam-text">ゲームタイトル・説明</strong>
            ・投稿者・投稿日の範囲で写真/動画を絞り込めます。写真に書いた説明も対象なので、
            「あのときの決めゼリフ」のような覚え書きからも辿れます。
            自分が閲覧権限を持つアルバムの投稿だけが対象です。
          </p>
          <p>
            ゲームタイトル欄に入力すると、写真だけでなく
            <strong className="text-steam-text">グループのゲームリストと提案</strong>
            からも一致するものを探して、まとめて表示します。
          </p>
          <p className="text-steam-muted/70">
            注意：投稿者の欄は<strong className="text-steam-text">ユーザーIDで指定します</strong>
            （表示名では引けません）。
          </p>
        </div>
      ),
    },
    {
      id: "account",
      title: "アカウントの設定（Discord連携・表示名）",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            <strong className="text-steam-text">Discord連携</strong>：Discordに投稿した画像を
            「自分の投稿」として取り込むには、
            <strong className="text-steam-text">Discordアカウントでログインしている必要があります</strong>。
            設定 → Discord連携で、連携できているかを確認できます。未連携と出ている場合は、
            一度Discordでログインし直してください。
          </p>
          <p>
            <strong className="text-steam-text">表示名</strong>：設定 → プロフィールから変えられます。
            投稿者の名前や、説明を書いた人の名前として表示されます。
          </p>
        </div>
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
