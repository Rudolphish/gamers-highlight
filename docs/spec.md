# ShareStaq 技術仕様書

> **これは着手前に書いた設計案です。** 方針（何を作るか・なぜその構成か）はいまも生きていますが、
> 実装は当時の想定を超えて広がっています（グループ、ゲームリスト、提案、招待リンク、活動ログなど）。
> **いま何がどこまで入っているかは [`handoff.md`](./handoff.md)**、これから何を作るかは
> [`roadmap.md`](./roadmap.md) を見てください。
> このファイルのうち §4〜§6 は**現在の実装に合わせて更新してあります**（2026-08-23）。

## 1. サービス概要

| 項目 | 内容 |
|---|---|
| サービス名 | ShareStaq |
| コンセプト | Discordに流れていくゲームのスクショを自動で拾い集め、ゲームごとに整理・共有できるWebアプリ |
| 主な価値提供 | 「あのスクショどこだっけ」をなくす。Discordに貼るだけで、後から迷わず辿り着ける置き場所になる |

### 1.1 開発の背景（コアペイン）
友達とDiscordでゲームをプレイした際に面白い場面のスクショを貼り合うが、時系列でしか流れないため後から「あのスクショどこだっけ」となりがち。特に複数のゲームのスクショが同じチャンネルに混在すると、過去の投稿を探すのが困難になる。

Discordは「投稿の場」としては優れているが、「後から検索・整理する場」としては構造的に弱い。この隙間を埋めるのが本サービスの狙い。

### 1.2 主要機能（今回のスコープ）
1. **Discord Bot連携**：Discordに投稿された画像・動画を自動で検知・取り込み（コア機能）
2. **画像（静止画）と短い動画クリップ（2分以内）の両方に対応**
3. ゲームタイトルごとの自動グルーピング（チャンネル/タグベース）
4. スクリーンショット/クリップの手動アップロード（Discordを使わない場合の代替導線）
5. アルバムの作成・編集
6. 写真／アルバムを特定ユーザーへ共有（権限管理）
7. ゲーム名・投稿者・日付での検索・フィルタ
8. **招待制ログイン（許可リストに無いアカウントはアクセス不可）**

### 1.3 認証・アクセス制御
オープンサインアップにはせず、**許可リスト（`AllowlistEntry`）に事前登録されたアカウントのみログイン可能**にする。

- 照合は`discordUserId`または`email`で行う
- **Googleログインは2026-08-07に削除した**（いまはDiscordのみ）。判断の理由は記録が残っていない
- 許可リストに無いアカウントは`signIn`コールバックで拒否され、ログイン画面に「まだ招待されていません」と表示される
- 許可リストへの登録は**設定 → 許可リスト**の画面から行う（`ADMIN_EMAILS` に載っている人だけ）。
  最初の1人は`packages/db/seed-allowlist.ts`で入れる。グループの**招待リンク**を使うと、
  相手がログインした時点で許可リストへの登録とグループ加入がまとめて済む
- `middleware.ts`により、未ログイン状態では`(main)`配下の全ページへのアクセスを`/login`にリダイレクトする

### 1.3 アップロード上限（画像/動画共通ポリシー）

| メディア種別 | 対応形式 | サイズ上限 | 長さ上限 |
|---|---|---|---|
| 画像 | PNG / JPEG / WebP | 15MB | ― |
| 動画 | MP4 / WebM / MOV | 100MB | 2分 |

値は`apps/web/src/lib/media-limits.ts`に一元化する（画面の文言も`MEDIA_LIMIT_LABELS`から組み立てるので、数値を変えれば表示も追随する）。
Botは`rootDir`の都合で直接importできないため`apps/bot/src/lib/mediaLimits.ts`に写しを置き、
`tools/local-test/audit-media-limits.mjs`が食い違いをCIで落とす。

**2026-09-06に30MB/30秒から引き上げた**（「容量が少なすぎて困る」という実運用の声）。
同時に、それまで**一度も効いていなかった長さの判定**を手動アップロード側で有効にした
（クライアントが`<video>`のメタデータから測って`durationSeconds`を送る）。
Discord経由は長さを判定しない——添付に長さの情報が無く、Bot側で測る手段もないため。

### 1.4 動画サムネイルの方針
サーバー側でのffmpeg等による自動抽出は行わない（実行環境の制約とコストを避けるため）。
- **デフォルト**：手動アップロード時、クライアント側で`<video>`+`<canvas>`から1フレーム目を抽出して画像としてアップロード
- **任意**：ユーザーが好きな画像をサムネイルとして指定することも可能
- **Discord Bot経由の動画**：クライアントを介さないためサムネイルは生成されず、表示側で`<video preload="metadata">`をそのままグリッドに描画し、ブラウザの先頭フレーム表示に委ねる

---

## 2. 想定ユーザーストーリー

- ユーザーA・B・Cは普段通りDiscordの「#elden-ring」チャンネルにゲームのスクショを貼って盛り上がる
- Botが投稿を検知し、自動でShareStaq上の「エルデンリング」アルバムに取り込む
- 数週間後、ユーザーAは「あの時のボス戦のスクショ」を探したくなり、アプリでゲーム名・日付で検索してすぐ見つける
- ユーザーAはお気に入りの数枚だけを抜き出して新しいアルバム「神ボス戦まとめ」を作り、B・Cと共有する
- Discordに投稿する習慣を変えずに、自然と整理されたアルバムが出来上がっていく

---

## 3. 技術スタック提案

| レイヤー | 採用技術 | 理由 |
|---|---|---|
| フロントエンド | **Next.js (React) + TypeScript** | SSR/SEO対応、画像最適化(next/image)が強力、API Routesで軽量BFFも可能 |
| UIライブラリ | Tailwind CSS + shadcn/ui | 開発速度と一貫したデザインの両立 |
| バックエンド | **Next.js API Routes / Route Handlers**（小規模）→ 将来的に **NestJS** へ分離可能 | 初期はモノレポで速く、成長したら分離しやすい構成 |
| DB | **PostgreSQL**（Supabase推奨） | リレーショナルなユーザー・アルバム・共有権限の管理に最適 |
| ORM | Prisma | 型安全なスキーマ管理、マイグレーションが容易 |
| 画像ストレージ | **Cloudflare R2** または AWS S3 | スクショ画像の大量アップロードに強く、CDN配信も容易 |
| 認証 | **NextAuth.js (Auth.js)** | Discordログインのみ（Googleは2026-08-07に削除） |
| ホスティング | Vercel（フロント）＋ Supabase（DB/Storage可） | 個人開発〜小規模チームでも運用コストを抑えられる |
| 画像処理 | ~~sharp~~ → **使っていない** | サーバー側での変換は入れず、動画サムネイルはクライアントで抽出、表示は`next/image`に任せている（§1.4） |
| **Discord Bot** | **discord.js**（常駐プロセス） | メッセージ投稿をリアルタイム検知するにはGateway常時接続が必須のため、サーバーレスではなく常駐サーバーで運用 |
| Bot ホスティング | Railway / Fly.io | Botプロセスの24時間稼働を安価に維持できる。**Botが落ちても通知系は動く**（Discordへの投稿はWeb側からREST APIで直接行うため） |

> 個人開発〜スモールチームでの立ち上げを想定し、運用負荷が低い構成を優先しています。Discord Bot部分のみアプリ本体（Vercel）とは別プロセスで常駐運用する点が構成上のポイントです。

---

## 4. データモデル（ER概要）

**実装済みのモデル**（`packages/db/schema.prisma` が正。ここは地図として読むもの）。
当初この節に書いていたのは `User` / `Album` / `Photo` / `AlbumMember` / `DiscordChannelMapping` の
5つだけで、**`Group` すら無かった**。実際にはグループが共有の単位になっている。

| かたまり | モデル | 役割 |
|---|---|---|
| 人と権限 | `User` / `AllowlistEntry` | ログインできる人（招待制）。許可リストは`discordUserId`か`email`で照合 |
| | `Group` / `GroupMember` | 共有の単位。OWNER / EDITOR / VIEWER |
| | `GroupInvite` / `GroupInviteUse` | 招待リンク。**回数は「ログインした時点」で消費する**（`CLAUDE.md` 参照） |
| メディア | `Album` / `AlbumMember` | アルバムとその共有。グループに属さない個人アルバムもある |
| | `Photo` / `PhotoReaction` | 写真・動画と❤️。説明は`Photo`の列（1枚に1つ） |
| Discord | `DiscordGameTag` | ハッシュタグ⇄アルバムの対応（複数タグ→1アルバム） |
| | `DiscordChannelMapping` | チャンネル⇄ゲームの対応（タグが無い運用向け・任意） |
| | `BotHeartbeat` | Botの死活監視 |
| ゲーム | `GroupGame` / `GroupGameInterest` | グループのゲームリスト（WISHLIST/PLAYING/BACKLOG/COMPLETED）と「気になる」 |
| | `GroupGameProposal` / `GroupGameProposalReaction` | ゲームの提案と投票（👍が過半数で自動採用） |
| | `ExternalGameCache` | Steam以外の外部（HowLongToBeat・YouTube・ITAD）の取得結果。**失敗を「取得済み」にしない**作り |
| 運用 | `ApiUsage` | 外部APIの消費量（YouTubeのクォータ監視） |
| | `AppSetting` | 通知先チャンネルなど、**再デプロイせずに変えたい設定** |
| | `ErrorReport` | 画面のエラー（`/admin/errors`） |
| 活動 | `ActivityLog` | 出来事の記録。**1年で消す**。週次まとめとカレンダーが読む |
| | `DailyActivity` | 日次ロールアップ。**永久に残す**。設計は[`activity-log.md`](./activity-log.md) |

**`ActivityLog` には外部キーを張っていない**（張ると写真を消したときに「消えた」記録ごと消える）。
`Photo.albumId` が null の投稿は「未分類」で、どのグループの出来事か決まらない点にも注意。

### 4.1 権限モデル
- **OWNER**：アルバムの削除・メンバー管理が可能
- **EDITOR**：写真の追加・削除が可能
- **VIEWER**：閲覧のみ

写真単体の共有は「専用アルバム（非公開・1枚用）」として扱うか、`Photo`に直接`SharedWith`テーブルを持たせる設計も可能（初期は前者を推奨、シンプルなため）。

### 4.2 Discord連携の前提
- BotがDiscord投稿を取り込むには、投稿者が事前にアプリ側でDiscordアカウントを連携（OAuthログイン）している必要がある
- 未連携ユーザーの投稿は取り込み対象外とするか、「未所属ゲスト投稿」として一時保存し、後から本人に紐付けを促す設計も検討可能
- `DiscordChannelMapping`は、サーバー管理者またはアルバムのOWNERが管理画面から設定する（ゲームごとにチャンネルが分かれている運用向け・任意）

### 4.3 ゲーム判定の優先順位（1チャンネル運用が主軸）
友人グループのように「1つのチャンネルに全ゲームが混在する」運用を主対象とし、判定は以下の優先順位で行う：

1. **メッセージ本文のハッシュタグ**（例：`#eldenring`）を最優先。初出のタグは自動でゲーム/アルバムを新規登録する（`DiscordGameTag`テーブル、事前の管理画面設定は不要）
2. ハッシュタグが無ければ`DiscordChannelMapping`（チャンネルごとにゲームが分かれている運用向け）にフォールバック
3. どちらも無ければ**未分類**として保存し、後からアプリのUIで手動振り分けできるようにする

タグの表記ゆれ（`#eldenring` / `#elden_ring`等）への対策として、**アルバムごとに複数のハッシュタグ（別名）を登録できるタグ管理機能**を用意する：

- アルバム詳細画面から、そのアルバムに紐付けたいハッシュタグを追加登録できる
- 既に別のアルバムに紐付いているタグを追加すると、そのタグはこのアルバムへ「付け替え」される（＝表記ゆれの統合操作そのもの）
- 例：「エルデンリング」アルバムに`#eldenring`と`#elden_ring`の両方を登録しておけば、どちらの表記で投稿されても同じアルバムに集約される
- ingest側のタグ解決ロジックは変更不要（`DiscordGameTag`テーブルは元々「複数タグ→1アルバム」の多対1構造のため）

---

## 5. 主要画面一覧（現在の実装）

| 画面 | パス | 概要 |
|---|---|---|
| ログイン | `/login` | Discord OAuth（許可リストに無ければ拒否） |
| ホーム | `/` | 最近の投稿とマイグループ |
| アルバム一覧 / 作成 | `/albums`, `/albums/new` | 並び替え（更新順・新着順・名前順・写真の多い順） |
| アルバム詳細 | `/albums/[albumId]` | 写真グリッド、Lightbox、❤️、説明、メンバー、タグ（別名）管理 |
| 未分類の投稿 | `/albums/unclassified` | ゲームが決まらなかった投稿の振り分け |
| グループ一覧 / 作成 | `/groups`, `/groups/new` | |
| グループ詳細 | `/groups/[groupId]` | メンバー、アルバム、ゲームリスト、提案、招待リンク |
| グループ内アルバム作成 | `/groups/[groupId]/albums/new` | |
| ゲーム詳細 | `/groups/[groupId]/games/[gameId]` | ステータス、Steamレビュー・価格、HowLongToBeat、YouTube、アプデ情報、👀気になる |
| 提案詳細 | `/groups/[groupId]/proposals/[proposalId]` | 👍/🤔/👎 の投票 |
| 検索 | `/search` | ゲーム名・投稿者・日付・説明で絞り込む |
| アップロード | `/upload` | 署名付きPUTで直接ストレージへ |
| 招待リンク | `/invite/[token]` | **未ログインでも開ける**（踏んでログインすると許可リストに載る） |
| マニュアル | `/manual` | 使い方 |
| 設定 | `/settings/profile`, `/settings/allowlist`, `/settings/discord`, `/settings/channel-mapping` | プロフィール、許可リスト、Discord連携、チャンネル対応 |
| 管理者 | `/admin`（使用量）, `/admin/users`, `/admin/weekly`, `/admin/activity`, `/admin/invites`, `/admin/media`, `/admin/errors` | `ADMIN_EMAILS` に載っている人だけ。週次まとめと活動カレンダーは**まず管理者だけに出している**（見せ方が固まってからグループへ広げる） |

**`(main)` 配下にページを足したら `src/middleware.ts` の matcher にも足すこと。**
漏れると未ログインでも描画まで進む。IDを受け取るページは**ページ側でも**権限を判定する
（APIが403でもページは素通りするため。どちらも `CLAUDE.md` に経緯がある）。

---

## 6. API設計（現在の実装）

全部で50本ほどあるので、かたまりで示す（正は `apps/web/src/app/api/`）。

| かたまり | 主なエンドポイント |
|---|---|
| 写真 | `POST /api/photos`（レコード作成）、`POST /api/photos/upload-url`（署名付きPUTの発行）、`DELETE /api/photos/:id`、`POST /api/photos/:id/reactions`（❤️）、`PATCH /api/photos/:id`（説明）、`POST /api/photos/assign-album`、`POST /api/photos/identify`、`GET /api/photos/search` |
| アルバム | `GET,POST /api/albums`、`GET,PATCH,DELETE /api/albums/:id`、`/api/albums/:id/photos`、`/api/albums/:id/members[/:userId]`、`/api/albums/:id/tags[/:tagId]` |
| グループ | `GET,POST /api/groups`、`/api/groups/:id`、`/api/groups/:id/members[/:userId]`、`/api/groups/:id/invites[/:inviteId]`、`/api/groups/:id/discord-channels` |
| ゲーム | `/api/groups/:id/games[/:gameId]`、`/api/groups/:id/games/:gameId/interest`（👀）、`/api/groups/:id/games/:gameId/refresh`（外部データの埋め直し）、`/api/search/group-games`、`/api/steam/search` |
| 提案 | `/api/groups/:id/proposals[/:proposalId]`、`/api/groups/:id/proposals/:proposalId/reactions` |
| 招待 | `/api/invites/:token/claim`（ログイン前に踏んだ記録）、`/api/invites/:token/accept`（加入）、`/api/admin/invites/:inviteId`（取り消し） |
| Discord | `POST /api/discord/ingest`（Botからの取り込み）、`POST /api/discord/tag`、`/api/discord/link`、`/api/discord/channel-mappings[/:id]` |
| 内部API（Bot専用・`INTERNAL_API_SECRET`） | `/api/internal/assign-game`、`/api/internal/group-games`、`/api/internal/bot-heartbeat` |
| 定期実行（`CRON_SECRET`） | `/api/cron/check-wishlist-prices`、`/api/cron/check-bot-health` |
| 運用 | `POST /api/errors`（画面のエラー通報）、`/api/admin/error-notify`、`/api/admin/weekly-notify`、`/api/allowlist[/:id]`、`/api/users`、`/api/users/me` |

**アップロード方式**：クライアント→サーバーへ直接バイナリを送るのではなく、R2の**署名付きPUT**を
サーバーが発行し、クライアントから直接ストレージへPUTする。**POSTは使えない**（R2が501を返し、
しかもCORSヘッダーが付かないためCORSエラーに見える）。**レコードはアップロード成功後に作る**
（先に作ると404のURLを指した行が残る）。Discord経由の画像はBotがダウンロードし、
`/api/discord/ingest` 経由でサーバー側から保存する。

---

## 7. 非機能要件

| 項目 | 方針 |
|---|---|
| パフォーマンス | サムネイル自動生成、遅延読み込み(lazy loading)で一覧表示を高速化 |
| セキュリティ | 署名付きURLの有効期限を短く設定、アルバムアクセスは必ずAPI側で権限チェック |
| スケーラビリティ | 画像はオブジェクトストレージ＋CDN配信、DBは正規化された権限テーブルで管理 |
| モバイル対応 | レスポンシブ対応必須（ゲームプレイ後にスマホから見る利用シーンを想定） |
| 拡張性 | 将来的なコメント機能・いいね機能・ゲームタイトル自動認識(画像解析)を見据えた設計 |
| 可用性 | Discord Botプロセスが落ちても手動アップロードは継続可能な疎結合設計とする |
| データ整合性 | Discordの画像URLは有効期限があるため、取り込み時に即座に永続ストレージへ移送する |

---

## 8. 開発ロードマップ（着手前の案・現在は roadmap.md が正）

> **この節は歴史。** Phase 1〜5に相当する部分は全て入っており、その後の展開
> （グループ、ゲームリスト、提案、セール通知、活動ログ）はここに書かれていない。
> **現在のロードマップは [`roadmap.md`](./roadmap.md)** を見ること。

| フェーズ | 内容 |
|---|---|
| Phase 1 | 認証（Discord OAuth含む）、手動アップロード、マイページ表示 |
| Phase 2 | **Discord Bot連携（1チャンネル運用・ハッシュタグでゲーム判定、初出タグは自動登録）** |
| Phase 3 | 検索・フィルタ機能、アルバム作成・写真の手動整理 |
| Phase 4 | 共有機能（招待・権限管理） |
| Phase 5 | UI磨き込み・サムネイル最適化・モバイル対応強化 |
| Phase 6（将来） | コメント／いいね、複数サーバー対応、スラッシュコマンドでのゲームタグ付け、SNS連携投稿 |

> 従来案では共有機能を優先していたが、コアペイン（Discordでのスクショ検索性の低さ）を最速で解消するため、**Discord Bot連携をPhase 2に前倒し**。

---

## 9. リスク・検討事項

- 画像著作権・ゲーム会社の利用規約（スクリーンショット公開ポリシー）の確認が必要
- 大量アップロード時のストレージコスト管理（無料枠の設計、圧縮方針）
- 招待フローのUX（メールアドレス招待 or ユーザー名検索、どちらを優先するか）
- **Discord未連携ユーザーの投稿の扱い**（取り込み対象外にするか、ゲスト投稿として保持し後から紐付けを促すか）
- **チャンネル⇄ゲームの手動マッピングの手間**（初期は許容するが、将来的にはフォーラムチャンネルのタグ機能自動読み取りなどで軽減したい）
- Bot常駐プロセスのダウンタイム時の取りこぼし対策（再接続時に過去メッセージを遡って取り込む機能の要否）
- Discordの利用規約・レートリミットの範囲内でのBot運用
