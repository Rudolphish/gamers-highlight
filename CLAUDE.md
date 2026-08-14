# CLAUDE.md

このリポジトリで**実際に踏んだ落とし穴**の記録。同じところで時間を溶かさないために書いている。
一般論は書かない。ここに載っているのは全て「一度やらかしたこと」。

## DB（Supabase）

### 接続先が2つある

| 用途 | 接続先 | 環境変数 |
|---|---|---|
| アプリの実行時 | Supavisor プーラー（**6543**番、`pgbouncer=true`） | `DATABASE_URL` |
| マイグレーション | 直接接続（**5432**番、`db.<ref>.supabase.co`） | `DATABASE_DIRECT_CONNECT` |

**`DATABASE_URL` をプーラー以外にしてはいけない。** サーバーレスは実行ごとに接続を張るため、
直接接続だとすぐ上限に達する。`docs/review-checklist.md` にもチェック項目がある。

### `prisma db push` がハングしたら接続先を疑う

プーラー経由でマイグレーションを流すと、アドバイザリロックが成立せず
**エラーも出さずに固まる**。`Datasource "db": ... at ...:6543` と出たまま返ってこない状態がそれ。

`schema.prisma` の `directUrl` で振り分けているので、通常は意識しなくてよい。
ハングした場合は `DATABASE_DIRECT_CONNECT` が設定されているかを確認する。

なお `directUrl` が未設定でも `prisma generate` は成功する（実測済み）ため、
Vercel のビルドが壊れることはない。影響するのは `db push` / `migrate` / `validate` だけ。

### スキーマを変えたら push を忘れない

Vercel はコードだけをデプロイする。**テーブルは自動では作られない。**
デプロイ後に `The table \`public.xxx\` does not exist` が出たらこれ。

```bash
pnpm --filter @gamers-highlight/db exec prisma db push
```

実行前に**ローカルが最新か確認すること**。古い `schema.prisma` のまま実行すると
「already in sync」と言われて何も作られず、しかも成功したように見える。

## 外部API

### Steam の検索は日本語名を返す

`searchSteamGames` は `l=japanese` で呼んでいるため、`GroupGame.title` には
「モンスターハンター：ワールド」のような**日本語名**が入る。

英語タイトル前提の外部サービス（HowLongToBeat）にこれを渡すと**必ず0件になる**。
英語名は `getSteamAppSummary`（appdetails、`l` を付けずに呼ぶ）の `name` から取る。
逆に YouTube は日本語名の方が実況動画に当たるので、そのまま渡してよい。

### カバー画像のURLを組み立ててはいけない

`steam/apps/<id>/header.jpg` という固定パスは、Steam がアセットを
`store_item_assets/steam/apps/<id>/<ハッシュ>/header.jpg` に移して以降
**新しいタイトルで404になる**。ファイル名が `header_alt_assets_0.jpg` のケースもあり、
パスを推測しきることは原理的にできない。必ず appdetails の `header_image` を使う。

古いタイトルでは旧パスが今も通るため「一部のゲームだけ画像が出ない」という
分かりにくい出方をする。新しくゲームを保存する経路を足したら、ここを必ず通すこと。

### storesearch はゲーム以外も返す

`type: "app"` 以外に `"sub"`（パッケージ）や `"bundle"` も返る。それらの `id` は
app ID ではないため、採用すると画像・appdetails・レビュー・ITAD が軒並み壊れる。
検索モーダルのサムネイルは API 提供の `tiny_image` なので正常に見え、
**追加した後だけ壊れる**という出方をする。

### YouTube のクォータは実質100回/日

`search.list` は1回100ユニット、無料枠が1日10,000。**ページ表示のたびに呼んではいけない。**
ゲーム追加・手動リフレッシュ時に1回だけ呼んでDBに保存する。
消費量は `ApiUsage` に記録され、`/admin` で見られる。

`<Link>` のプリフェッチだけでページが描画されうる点にも注意。提案の詳細ページで
YouTube を引かずキャッシュ済みの値だけ出しているのはこのため。

### HowLongToBeat は非公式スクレイピング

`/api/bleed`（認証は `/api/bleed/init`）。**先方の仕様変更で壊れる前提**。
ヘッダーだけでなく**ボディにも `{hpKey}: hpVal` を入れる**必要がある。
壊れたときの切り分けのため、失敗理由は `[hltb]` タグでログに出している。

## Next.js

### fetch は既定でキャッシュされる

App Router のオプション無し `fetch` は `force-cache`。何も指定しないと
**一度取得した価格やレビューが更新されないまま固定される**（実際に発生した）。
毎回描画する情報は `gameFetchOptions()`、追加・リフレッシュ時だけ引くものは
`cache: "no-store"` を明示する。

### middleware の matcher は追加漏れする

`(main)` 配下にページを足したら `src/middleware.ts` の matcher にも足すこと。
漏れると未ログインでも描画まで進む。実際に `/groups` と `/manual` が漏れており、
`/groups/new` は未ログインで作成フォームが出て、`/groups/[groupId]/albums/new` は500になっていた。

### 画面のエラーは /admin/errors に集まる

エラーバウンダリ（`app/error.tsx`・`app/(main)/error.tsx`・`app/global-error.tsx`）が
`/api/errors` へ通報し、`ErrorReport` に記録される。Discordへの通知先は環境変数ではなく
`AppSetting`（`errorNotifyChannelId`）に持たせてある。**再デプロイせずに変えられるようにするため。**

**本番のサーバー側エラーはNext.jsがメッセージを伏せる**ので、記録されるのは
「An error occurred in the Server Components render...」という汎用文と digest だけになる。
原因を追うにはその digest でVercelのログを検索する。実測で確認済みの挙動なので、
メッセージが具体的でないこと自体は不具合ではない。

同じ内容の通知は30分に1回までにまとめている（同じ不具合の連投でチャンネルが埋まると、
かえって気づけなくなるため）。通知に失敗した場合は `notifiedAt` を更新しないので次回また試す。

### 外部依存はセクション単位で失敗させる

1つの取得失敗でページ全体を落とさない。`Promise.allSettled` で個別に握りつぶし、
そのセクションだけ非表示にするか理由を表示する。`/admin` はこれを怠って
テーブル未作成で全体が500になった。

## ストレージ（R2）

### 動画のサムネイルは Photo レコードを持たない

`thumbnailUrl` が指すオブジェクトには対応する `Photo` 行が無い。
**「Photoを消したらオブジェクトも消す」を素朴に実装すると全動画のサムネイルが壊れる。**
サムネイルは `/api/photos/upload-url`（署名だけ返し、レコードを作らない）経由でアップロードする。

削除時は、他のレコードが `mediaUrl` / `thumbnailUrl` として参照していないかを確認してから消す。

### レコードはアップロード成功後に作る

`/api/photos/upload-url` で署名を取り、ストレージへ上げ切ってから `/api/photos` で
`Photo` を作る。**この順序を逆にしてはいけない。** 先にレコードを作ると、アップロードが
失敗したときに404のURLを指した行が残り、ホームやアルバムに壊れた画像として出続ける
（電波の悪い場所では普通に起きる）。この順序なら、失敗して残るのは参照されない
オブジェクトだけで画面には出ず、`/admin` の「孤児ファイル」で把握できる。

URLの出どころがクライアントになるので、`/api/photos` は `mediaUrl` / `thumbnailUrl` が
自前のストレージ上のものかを `isManagedStorageUrl` で必ず検証する。

### R2のトークンには list 権限が要る

`/admin` の使用量はバケットを列挙して実測している。read/write だけのトークンだと
**オブジェクトの読み書きは通るのにこのページだけ失敗する**。

## 権限

### 管理者は `ADMIN_EMAILS`（フェイルクローズ）

許可リストの編集と `/admin` は `ADMIN_EMAILS`（カンマ区切り）に載っている人だけ。
**未設定なら誰も使えない。** 「許可リストに載っている人なら誰でも編集可」にしないのは、
メンバーの1人が第三者を招き入れられると招待制の意味が無くなるため。

セッションの `isAdmin` は**表示の出し分け専用**。権限判定は必ずサーバー側で
`isAdminEmail()` を呼ぶこと。

### 招待リンクは「ログインした時点」で1回分を消費する

`AllowlistEntry` を作る＝**アプリへの恒久的なログイン権限を渡す**ということ。
なので回数を数えるのはグループ加入時ではなく**許可リストに載せた瞬間**でなければならない。

最初はグループ加入時にだけ `usedCount` を加算していたが、これだと
「1回限り」のリンクでも、**誰も加入を終えていない間はリンクを踏んだ人全員がログインできた**
（実測: 1回限りのリンクを3人が踏んで3人とも許可リストに載った）。

加入時に二重で数えないよう、消費済みかどうかは `AllowlistEntry.inviteId` が
残っているかで見分ける。加入したら `null` に戻す。この列は取り消しのためにも要る:
**取り消しは `revokedAt` を立てるだけでは足りない。** リンクを踏んでログインまで済ませた
相手は既に許可リストに載っており、放置するとアプリには入れたままになる
（グループ加入だけは止まるので、余計に気づきにくい）。

未加入の登録の回収は `purgePendingInviteAllowlist()`。定期実行の枠が空いていないので、
招待の取り消しと一覧取得のついでに呼んでいる。

この `inviteId` の外部キーは **`onDelete: Cascade` でなければならない。**
最初 `SetNull` にしていたが、グループを削除すると `GroupInvite` がカスケードで消え、
未加入の予約が「加入済み」と同じ姿（`inviteId` が `null`）に化けて回収対象から外れる。
結果、**グループを消しただけで、リンクを踏んだだけの人が恒久ログインできるようになる**
（実測で再現済み）。招待が物理削除されるのはこのカスケードだけなので、
`Cascade` なら「グループが消えたら未加入の権限も消える」で辻褄が合う。

### 新メンバーの導線は3段階

1. 許可リストに追加（設定 → 許可リスト、または `packages/db/seed-allowlist.ts`）
2. 本人が一度ログインする
3. 既存メンバーがグループに招待する

**2を挟まないと3の招待候補に出てこない**（招待は登録済み `User` から選ぶため）。
許可リスト画面に「ログイン済み / 未ログイン」を出しているのはこれが理由。

## ビルド・デプロイ

`docs/review-checklist.md` の「デプロイ・環境まわり」を触るときは特に慎重に。
過去に壊した実績があるもの:

- `.npmrc` の `node-linker=hoisted`
- Prisma の engine type（`library` のまま）
- `next.config.js` の `serverComponentsExternalPackages` / `outputFileTracingRoot`
- NextAuth のルートの `export const dynamic = "force-dynamic"`
