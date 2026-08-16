# ローカル総合テスト

本番のDBにも外部APIにも触れない環境で、アプリを**本番ビルドのまま**通しで動かして確認するための一式。
`docs/handoff.md` の「開発環境の再現」を毎回手で組み直さなくて済むように、実際に使った手順をそのまま置いてある。

Vercelにも本番にも一切影響しない。CIからは呼んでいない（外部サービスをスタブするので、
これが通ることは本番が動くことの証明にはならない。あくまで**壊れていないことの下限**を確認する道具）。

## 使い方

```bash
# 1) Postgresを立てる（16、5433番、/tmp にソケット）
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/ghdata -U postgres -A trust"
setsid su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/ghdata \
  -o '-p 5433 -k /tmp' -l /tmp/pg.log start"
su postgres -c "psql -p 5433 -h /tmp -U postgres -c 'CREATE DATABASE gh;'"

export DATABASE_URL="postgresql://postgres@localhost:5433/gh?host=/tmp"

# 2) スキーマを流す（db push は権限で失敗するので migrate diff の出力を psql に流す）
npx prisma migrate diff --from-empty \
  --to-schema-datamodel packages/db/schema.prisma --script > /tmp/gh-schema.sql
su postgres -c "psql -p 5433 -h /tmp -U postgres -d gh -f /tmp/gh-schema.sql"

# 3) apps/web/.env.local を用意する（下の「環境変数」参照）

# 4) モックのストレージと本番ビルドを起動する
node tools/local-test/mock-r2.mjs &
pnpm --filter web build
NODE_OPTIONS="--require $PWD/tools/local-test/fetch-stub.cjs" pnpm --filter web start &

# 5) 全部流して docs/test-results.md を作り直す
node tools/local-test/run-all.mjs
```

`run-all.mjs` がシード投入 → 各スイート → 表の生成までやる。
個別に流したいときは `SEED_IDS` を渡して単体で実行してもよい。

```bash
node tools/local-test/seed.mjs
export SEED_IDS=$(node tools/local-test/ids.mjs)
node tools/local-test/sweep.mjs             # P: ページの到達性と権限
node tools/local-test/api-sweep.mjs         # R: APIの権限
node tools/local-test/flows.mjs             # F: 主要導線
node tools/local-test/external-failure.mjs  # X: 外部API全滅時
node tools/local-test/browser.mjs           # B: 実ブラウザ（任意）
node tools/local-test/build-report.mjs      # 表だけ作り直す
```

## テスト項目表

項目と結果は [`docs/test-results.md`](../../docs/test-results.md) に書き出される。
**あのファイルは手で書き換えない。** 項目を足すときはスクリプト側の配列に足して
`run-all.mjs` で作り直す（手で書くと、通っていない項目が「OK」で残る）。

IDの頭文字はスイートを表す: `P`=ページ、`R`=API権限、`F`=主要導線、
`X`=外部API全滅時、`B`=実ブラウザ。

`dev` ではなく **`next build && next start` で確認すること**。`dev` だとNext.js自身の
エラーオーバーレイが出て、アプリ側のエラーバウンダリの挙動が見えない。

## 中身

| ファイル | 役割 |
|---|---|
| `seed.mjs` | テストデータ投入。管理者・一般メンバー・部外者の3人と、それぞれのグループ/アルバム/写真/提案/招待リンク |
| `ids.mjs` | 投入したレコードのIDをJSONで出す（`SEED_IDS` に入れて他のスクリプトへ渡す） |
| `make-token.mjs` | NextAuthのセッションJWTを直接発行する。本番ビルドでは `dev-login` が無効なため |
| `mock-r2.mjs` | R2を模したストレージ。**POSTには501を返し、そのレスポンスにCORSヘッダーを付けない**（本番と同じ壊れ方を再現するため） |
| `fetch-stub.cjs` | Steam/ITAD/YouTube/HowLongToBeat/Discord の差し替え。`--require` で読ませる |
| `sweep.mjs` | **P**: 全ページを未ログイン＋3役割で開き、期待ステータスと突き合わせる |
| `api-sweep.mjs` | **R**: APIの権限を役割ごとに期待値と突き合わせる |
| `flows.mjs` | **F**: アップロード・招待・提案・ゲーム追加・Discord取り込み・エラー通報・cron を通しで確認 |
| `external-failure.mjs` | **X**: 外部APIを全滅させてもページが500にならないこと |
| `browser.mjs` | **B**: 実ブラウザ（Chromium）で開いて例外が出ないこと。`playwright-core` が無ければスキップ |
| `run-all.mjs` | 上を全部流して表を作り直す |
| `build-report.mjs` | `results/*.json` から `docs/test-results.md` を組み立てる |
| `_results.mjs` | 各スイートが結果を書き出す共通処理 |
| `verify-album-access.mjs` | アルバム詳細ページの権限マトリクス（単発の確認用） |
| `repro-album-leak.mjs` | 権限の無いアルバムがページから見えていた不具合の再現用 |

`browser.mjs` は `playwright-core` を使うが、**このリポジトリの依存には入れていない**
（本番のビルドに要らないものを増やしたくないため）。無ければ自動でスキップする。

**リポジトリのルートで `npm install` してはいけない。** `.npmrc` の `node-linker=hoisted` で
pnpmが平坦に置いた `node_modules` を npm が「身に覚えのないパッケージ」とみなして削り、
182個が18個まで消える（実際にやった。`pnpm install` で戻せるが、Prisma Clientの再生成も要る）。
入れるならリポジトリの外に置いてリンクする。

```bash
mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y && npm i playwright-core)
ln -sfn /tmp/pw/node_modules/playwright-core node_modules/playwright-core
export CHROMIUM_PATH=/path/to/chromium   # 未設定ならPlaywrightの既定を探す
```

## 外部が落ちた状況の再現

`/tmp/stub-fail` にホスト名（または `*`）を書くと、そのホストへの外部呼び出しが500を返す。
1箇所の取得失敗でページ全体が落ちないこと（`Promise.allSettled` によるセクション単位の失敗）を確認できる。

```bash
echo "*" > /tmp/stub-fail   # 全滅させる
rm /tmp/stub-fail           # 戻す
```

## 環境変数（`apps/web/.env.local`）

`.env.local` はgitignore対象なので各自で作る。ローカル専用の値でよい。

```
DATABASE_URL="postgresql://postgres@localhost:5433/gh?host=/tmp"
DATABASE_DIRECT_CONNECT="postgresql://postgres@localhost:5433/gh?host=/tmp"
NEXTAUTH_SECRET="local-integration-test-secret"
NEXTAUTH_URL="http://localhost:3000"
DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET       # 任意の文字列でよい
ADMIN_EMAILS="admin@example.com"                # seed.mjs の管理者と揃える
STORAGE_ENDPOINT="http://127.0.0.1:9100"
STORAGE_BUCKET="gh-local"
STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY
STORAGE_PUBLIC_URL="http://127.0.0.1:9100/gh-local"
INTERNAL_API_SECRET / CRON_SECRET / ITAD_API_KEY / YOUTUBE_API_KEY / DISCORD_BOT_TOKEN
```

`NEXTAUTH_SECRET` は `make-token.mjs` の既定値と一致させること。ずれるとログイン済みにならず、
「なぜか全部0件」という見え方になる。トークンの有効期限は1時間。

## 確認できないこと

スタブなので、**先方の仕様変更で壊れる類の不具合は出ない**。特に次は実機でしか分からない。

- 実物のR2が署名を受理するか（署名検証はモックでは行っていない）
- Steam `storesearch` / `appdetails` の実際の応答
- HowLongToBeat の非公式APIが今も生きているか
- Discordへの実際の送信、Bot上での表示

加えて、**画像が実際に表示されるかはローカルでは確認できない**。模擬R2は
`http://127.0.0.1:9100` にあり、`next.config.js` の `remotePatterns` は https の
特定ホストしか許可していないため、`next/image` が必ず400で弾く。本番の
`pub-*.r2.dev` は許可済みなので問題にならない。`browser.mjs` はこの400だけを
無視するようにしてある（他の画像エラーは拾う）。
