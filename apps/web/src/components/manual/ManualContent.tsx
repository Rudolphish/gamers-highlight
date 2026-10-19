"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { MEDIA_LIMIT_LABELS } from "@/lib/media-limits";
import { ChevronDown, ExternalLink } from "lucide-react";

type Section = { id: string; title: string; body: ReactNode };

export function ManualContent({ inviteUrl, isAdmin = false }: { inviteUrl: string | null; isAdmin?: boolean }) {
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
            補足：「/tag」「/playlog」コマンド（後述）は、Botを招待したどのサーバーでも使えます。
            入力欄に「/」を打っても出てこないときは、サーバー設定 → 連携サービス → Bot で、
            コマンドを使えるチャンネルが絞られていないか確かめ、Discordを再読み込みしてください。
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
            そのタグが初めて使われた場合、自動でアルバムが作成されます（アルバム名はタグ名がそのまま使われます）。2回目以降、同じタグを付けて投稿すると同じアルバムに自動で振り分けられます。アルバム名は後から変更できます（アルバム詳細で名前の右にある鉛筆アイコン。タグとの紐付けは名前を変えても切れません）。
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
            グループ画面の「みんなのゲーム」は、そのグループで話題になっているゲームを共有する場所です。各ゲームには「気になる」「プレイ中」「積みゲー」「クリア済み」のステータスを付けられます。
            ゲームは見出しの横の<strong className="text-steam-text">「ゲームを追加」</strong>から名前で検索して追加します（編集者以上）。
          </p>
          <p>
            <strong className="text-steam-text">開いた直後は「プレイ中」と「気になる」だけが表示されます。</strong>
            積みゲーやクリア済みも見たいときは、ステータスの並びの先頭にある「すべて」を押してください。
          </p>
          <p>
            ゲームカードの「気になる」ボタンは、ステータスとは別に「自分が狙っている」という印です。誰が狙っているかがカードに出るほか、ウィッシュリストの最安値がDiscordに通知されるときにも使われます。
          </p>
          <p>
            <strong className="text-steam-text">ウィッシュリスト</strong>（ゲームの提案）：グループ画面の「追加する」から「このゲームどう？」と提案すると、メンバーがリアクションできます。「いいね」がメンバーの過半数に達すると、自動でゲームリストに「気になる」として追加されます。
            <strong className="text-steam-text">提案するとDiscordにも通知が飛びます</strong>
            （「ゲームが提案されたとき」の通知先を設定している場合。下の「Discordへの通知」を参照）。
          </p>
          <p>
            <strong className="text-steam-text">提案は提案した人ごとに区画が分かれます。</strong>
            各区画に出るのは既定で5件までで、残りは「他N件を表示」で開けます。
            自分の区画のカードには順位の選択欄が出るので、1位〜5位を付けると
            その順に並びます（順位を付けていないものは新しい順であとに続きます）。
            <strong className="text-steam-text">順位を変えられるのは提案した本人だけ</strong>
            で、他の人の並びには影響しません。
          </p>
        </div>
      ),
    },
    {
      id: "album-steam-link",
      title: "アルバムとゲームを連携する（間違えたときの直し方）",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            アルバム詳細の<strong className="text-steam-text">「Steam連携」</strong>からは、
            2つの別のことができます。
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong className="text-steam-text">サムネイルに使う</strong>
              ：アルバムのカバー画像にSteamのヘッダー画像を使います（ゲームとの連携はしません）。
            </li>
            <li>
              <strong className="text-steam-text">このゲームに連携</strong>
              ：グループのゲームリストに追加して、アルバムから「ゲーム詳細を見る」で
              そのゲームのページへ行けるようにします。
            </li>
          </ul>
          <p>
            <strong className="text-steam-text">間違えたときは付け替えられます。</strong>
            モーダルの上部に「現在のゲーム: ◯◯」と出るので、違っていたら別のゲームを検索して
            「このゲームに付け替え」を押してください。確認が出たあとに切り替わります。
            そのとき<strong className="text-steam-text">間違って追加したゲームをゲームリストからも消すか</strong>
            をチェックで選べます（消すと、そのゲームに付いた他のメンバーの「気になる」も消えます）。
          </p>
          <p className="text-steam-muted/70">
            補足：「ゲームとの連携を解除する」を押すと、ゲームリストにはそのまま残したうえで
            アルバムとの紐付けだけを外せます。サムネイルは変わりません（戻したいときは
            「Steam画像を解除して投稿写真に戻す」を使ってください）。
            1つのゲームに連携できるアルバムは1つまでなので、他のアルバムが使っているゲームへは
            付け替えられません（その場合は先に相手側で解除してください）。
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
      id: "play-log",
      title: "グループで遊んだ時間（プレイ記録）",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            DiscordのVCに集まって、<strong className="text-steam-text">2人以上が同じゲームを遊んでいる間</strong>
            を、Botが自動で記録します。何かを押す必要はありません。
          </p>
          <p>
            <strong className="text-steam-text">記録が出る場所</strong>
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              グループ画面の上の帯「グループで遊んだ時間」：全ゲームの合計・いちばん遊んだゲーム・最後に遊んだ日
            </li>
            <li>「みんなのゲーム」の各カード：そのゲームを遊んだ時間（🎮）</li>
            <li>
              ゲーム詳細の「グループで遊んだ時間」：合計時間と、1回ずつの記録（一緒に遊んだメンバーつき）。
              記録が多いときは枠の中でスクロールします
            </li>
            <li>グループの「最近の動き」と活動カレンダー（下の「グループの活動」を参照）</li>
          </ul>
          <p>
            数えるのは、Discordに「〇〇をプレイ中」と出ている人がいるときです。
            <strong className="text-steam-text">「オンライン状態を隠す」にしている人も、同じVCで遊ばれているゲームが1つだけなら一緒に遊んだとして数えます</strong>
            （隠している人は、Botからはプレイ中が見えないため）。そのため、VCで雑談しているだけの人が入ることもあります。
            VCの中で別々のゲームが遊ばれているときは、隠している人はどちらにも入れません。
            アプリとDiscordを連携していない人は数に入りません。
          </p>
          <p>
            グループ画面の帯とゲーム一覧の時間には、ゲームリストに無い（名前だけの）記録と、1分未満しか遊んでいないゲームは入りません。
            ゲームリストに追加して結びつけると入ります。
          </p>
          <p>
            <strong className="text-steam-text">記録されたくないとき</strong>は、Discordで
            <code className="mx-1 rounded-sm bg-steam-panel px-1">/playlog off</code>
            （日本語の表示では「プレイ記録」）を使います。外れるのはそのサーバーのグループだけで、
            これまでの記録は残ります。戻すときは <code className="mx-1 rounded-sm bg-steam-panel px-1">/playlog on</code>、
            いまの状態は <code className="mx-1 rounded-sm bg-steam-panel px-1">/playlog status</code> で分かります。
          </p>
          <p>
            <strong className="text-steam-text">「ゲームが分からないプレイ」が出たとき</strong>
            ：Discordに出ていた名前がゲームリストと一致しなかったものです。グループ画面の「みんなのゲーム」の上に出るので、
            どのゲームか選んでください。過去の記録にも反映され、次からは自動で当たります。リストに無いゲームなら、
            先にゲームを追加すると自動で結びつきます。
          </p>
          <p className="text-steam-muted/70">
            補足：途中で10分以内に戻ってきた場合は、続けて1回として数えます。5分未満の記録は一覧に出しません（合計には含みます）。
            「推定」の印は、Botが止まっていた間をまたいだ記録です（止まっていた間は確認できないため、時刻が推定になります）。
          </p>
        </div>
      ),
    },
    {
      id: "group-activity",
      title: "グループの活動（最近の動き・活動カレンダー）",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            グループ画面の<strong className="text-steam-text">「最近の動き」</strong>に、写真の投稿・アルバムの作成・
            ウィッシュリストへの追加・一緒に遊んだ記録（🎮）などが、新しい順に5件出ます。
            同じ人が続けて写真を投稿したときは「写真を4枚投稿」のように1行にまとまります。
          </p>
          <p>
            右上の<strong className="text-steam-text">「カレンダーで見る」</strong>で、そのグループの活動カレンダーが開きます。
            日のマスには、その日の動きの件数（多いほど濃い色）と、一緒に遊んだ時間（🎮 と青い文字、例: 2h44m＝2時間44分）が出ます。
            マスを押すと、その日の内訳と1件ずつの記録が見られます。
          </p>
          <p className="text-steam-muted/70">
            補足：写真の削除・❤️の取り消し・投票の取り消し・説明を消した・提案の取り下げ・アルバムやゲームの削除・
            「気になる」を外した、は出しません（件数にも数えません）。「最近の動き」は投稿した時刻の順で、
            カレンダーは実際に起きた日（撮影日時が分かる写真はその日）に置きます。
            「アルバムを作成」の行には、作った時点のアルバム名が出ます（後から名前を変えても書き換わりません）。
          </p>
        </div>
      ),
    },
    {
      id: "price-notify",
      title: "Discordへの通知",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            グループ画面のグループ名の下にある「通知の設定」から、
            <strong className="text-steam-text">通知の種類ごとに送り先のチャンネルを選べます</strong>
            （グループのオーナーだけが設定できます）。種類ごとに違うチャンネルへ送っても構いません。
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong className="text-steam-text">ゲームが提案されたとき</strong>
              ：ゲーム名・提案した人・採用に必要な「いいね」の数が届きます
            </li>
            <li>
              <strong className="text-steam-text">ウィッシュリストが最安値を更新したとき</strong>
            </li>
            <li>
              <strong className="text-steam-text">週に一度のまとめ</strong>
              ：先週の投稿・クリア・提案などをまとめて届きます（動きが無かった週は送りません）
            </li>
            <li>
              <strong className="text-steam-text">プレイ記録の開始と終了</strong>
              ：VCで一緒に遊び始めたときと、遊び終わったときに、ゲーム名と参加者が届きます。
              終わりの通知は、抜けてから10分戻らなかったときに送るので、実際に届くのは終わってから10〜25分後です
            </li>
          </ul>
          <p>
            <strong className="text-steam-text">「送らない」を選べばその種類は届きません。</strong>
            既定は4種類とも「送らない」なので、設定するまで通知は一切飛びません。
          </p>
          <p>
            価格の通知は、「みんなのゲーム」で「気になる」ステータスのゲームと、
            <strong className="text-steam-text">ウィッシュリストのゲーム</strong>
            を毎日調べて、
            <strong className="text-steam-text">過去の最安値を更新したときだけ</strong>
            送ります。値下げのたびに鳴るわけではありません。同じゲームが両方に入っていても通知は1通です。
          </p>

          <p>
            通知には、そのゲームをウィッシュリストに入れた人（「📝 Aさんのウィッシュリスト」）と、
            「気になる」を付けているメンバーの名前も添えられます。
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
                  ["ウィッシュリストに追加する・投票する・「気になる」を付ける", "閲覧者"],
                  ["ゲームリストへの追加・ステータス変更・削除", "編集者"],
                  ["アルバムを作る", "グループの編集者"],
                  ["アルバム名を変える", "アルバムのオーナー、またはアルバムの編集者"],
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
            {`Discordを経由せず、サイドバーの「アップロード」から直接写真/動画を投稿することもできます。画像は${MEDIA_LIMIT_LABELS.imageSize}まで、動画は${MEDIA_LIMIT_LABELS.videoSize}・${MEDIA_LIMIT_LABELS.videoDuration}までのファイルに対応しています（png/jpeg/webp、mp4/webm/mov）。`}
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
          <p>
            <strong className="text-steam-text">アルバムの画面からも直接追加できます。</strong>
            アルバムを開いて右上の「追加」を押すと、写真/動画を複数まとめて選ぶか、
            YouTubeのURLを貼るかを選べます。追加先はそのアルバムなので、グループやアルバムを
            選び直す必要はありません（ゲームの自動判別もしません）。
            <strong className="text-steam-text">そのアルバムを見られる人なら誰でも追加できます。</strong>
          </p>
          <p>
            <strong className="text-steam-text">YouTubeの動画も並べられます。</strong>
            同じ画面の下にある「YouTubeの動画を追加」にURLを貼ると、アルバムに写真と同じように並びます。
            容量・長さの制限はありません（動画はYouTube側にあるので、こちらのストレージを使いません）。
            追加先のグループ／アルバム／ゲームタグは、上で選んだものがそのまま使われます。
          </p>
          <p className="text-steam-muted/70">
            補足：貼れるのは「watch」「youtu.be」「shorts」のURLです。再生位置（?t=）や
            プレイリスト（&list=）が付いていても構いません（保存時に外します）。
            <strong className="text-steam-text">非公開の動画は埋め込めません</strong>ので、
            共有したいものは「限定公開」以上にしてください。投稿した人が後から動画を消したり
            非公開にすると、こちらの画面ではYouTube側のエラー表示になります。
          </p>
          <p className="text-steam-muted/70">
            {`注意：上限を超えたファイルはその場でエラーになります（動画の長さはアップロードを始める前に確認します）。Discordに投稿した動画が${MEDIA_LIMIT_LABELS.videoSize}を超えていた場合は取り込まれず、Discord側にも何も出ません——大きい動画が反映されないときはサイズを疑ってください。Discord経由では長さは見ていません。`}
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
            （下のゲームリストやウィッシュリストが押し出されないようにするためです）。
          </p>
          <p>
            <strong className="text-steam-text">アルバム名</strong>は、アルバム詳細で名前の右にある
            鉛筆アイコンから変更できます（アルバムのオーナーと、そのアルバムに編集者として招待された人）。
            Enterで確定、Escで取り消しです。グループに参加しているだけの人には鉛筆は出ません。
          </p>
          <p>
            <strong className="text-steam-text">サムネイル</strong>は、アルバム詳細の
            Steamアイコンのボタンからゲームを検索して設定できます（アルバムのオーナーのみ）。
            同じ画面から、そのゲームをグループのゲームリストに追加することもできます。
            設定しない場合は、いちばん新しい投稿がサムネイルになります
            （<strong className="text-steam-text">YouTubeの動画はサムネイルに使いません</strong>。
            アルバムの見た目がYouTube側の画像に置き換わってしまうためです）。
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
            <strong className="text-steam-text">グループのゲームリストとウィッシュリスト</strong>
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
      id: "mobile",
      title: "スマホで使うとき（メニューの出し方）",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            スマホのような細い画面では、<strong className="text-steam-text">画面左上の三本線のボタン</strong>
            からメニューを開きます。ホーム・グループ・アルバム・アップロード・マニュアル・検索・設定が、
            アイコンと文字で並びます。
          </p>
          <p>
            閉じ方は4通りあります：<strong className="text-steam-text">行きたい場所を選ぶ</strong>、
            右上の×、<strong className="text-steam-text">メニューの外側（暗くなっている部分）をタップ</strong>、
            キーボードのEscキー。
          </p>
          <p className="text-steam-muted">
            パソコンなど横に広い画面では、三本線のボタンは出ません。代わりに画面の左端に
            アイコンだけの細い列が常に出ていて、アイコンにカーソルを合わせると名前が出ます。
          </p>
          <p>
            <strong className="text-steam-text">写真を見ているとき</strong>は、
            <strong className="text-steam-text">横に払って次／前の写真へ移れます</strong>。
            少しだけ払ったときは動かずに元に戻ります。左右の矢印ボタンも残してあります。
          </p>
          <p className="text-steam-muted">
            YouTubeの動画ではプレーヤーの操作が優先されるので、払っても移りません。
            動画も、再生バーの上では払えません（シーク操作が優先されます）。
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
    ...(isAdmin
      ? [
          {
            id: "admin",
            title: "管理者向けの機能（管理者にだけ表示）",
            body: (
              <div className="flex flex-col gap-3">
                <p>
                  メニューの「使用量・メディア」（盾のアイコン。<Link href="/admin" className="text-steam-blue hover:underline">/admin</Link>）から、
                  管理者だけが使えるページに入れます。上のタブで切り替えます。
                </p>
                <ul className="ml-4 list-disc space-y-1">
                  <li><strong className="text-steam-text">使用量</strong>：ストレージ・DB・YouTube検索の使用量と、参照されないファイル（孤児ファイル）の数</li>
                  <li><strong className="text-steam-text">ユーザー</strong>：誰がどのグループにいて、どれだけ投稿しているか</li>
                  <li><strong className="text-steam-text">週次まとめ</strong>：Discordへ送る週次まとめの文面を、送る前に期間を選んで確かめる</li>
                  <li><strong className="text-steam-text">活動カレンダー</strong>：全グループの活動を切り替えて見る（取り消し・削除系の出来事も出る）</li>
                  <li>
                    <strong className="text-steam-text">プレイ記録</strong>：記録の時間・ゲーム・参加者の修正、削除、記録されなかった回の追加。
                    遊んでいる最中の記録は、終わってから直せます
                  </li>
                  <li><strong className="text-steam-text">招待リンク</strong>：全グループの招待リンクを見て、取り消す</li>
                  <li><strong className="text-steam-text">メディア一覧</strong>：全部の写真/動画を見る。他の人の未分類の投稿もここから振り分けられる</li>
                  <li><strong className="text-steam-text">エラー</strong>：画面で起きたエラーとログインの失敗の記録、Discordへのエラー通知先の設定</li>
                </ul>
                <p>
                  グループ画面には、管理者にだけ<strong className="text-steam-text">「プレイ記録の最少人数」</strong>が出ます。
                  「1人（動作確認用）」にすると、1人で遊んでも記録されます（テスト用。友人のグループでは2人のままにしてください）。
                </p>
              </div>
            ),
          },
        ]
      : []),
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
