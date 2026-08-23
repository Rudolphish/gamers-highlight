# ShareStaq

Discordに流れていくゲームのスクリーンショットを自動で拾い集め、ゲームごとに整理・共有できるWebアプリ。

## ドキュメントの地図

**どれを読めばいいか迷ったら、まずここを見る。**

| 知りたいこと | 読むもの |
|---|---|
| **いま何がどこまで入っているか**（再開時はまずこれ） | [`docs/handoff.md`](docs/handoff.md) |
| このコードを触るときの落とし穴（実際に踏んだもの） | [`CLAUDE.md`](CLAUDE.md) |
| 進め方でやらかしたこと（確認の仕方・道具の使い方） | [`docs/lessons.md`](docs/lessons.md) |
| これから何を作るか・何を見送ったか | [`docs/roadmap.md`](docs/roadmap.md) |
| 何のためのサービスか（長期ゴール） | [`docs/vision.md`](docs/vision.md) |
| 当初の技術仕様（着手前の設計案＋現在の対応表） | [`docs/spec.md`](docs/spec.md) |
| テストの流し方 | [`tools/local-test/README.md`](tools/local-test/README.md) |
| テストの項目と結果 | [`docs/test-results.md`](docs/test-results.md)（自動生成・手で書き換えない） |
| Vercel に入れる環境変数 | [`docs/VERCEL_ENVIRONMENT_VARIABLES.md`](docs/VERCEL_ENVIRONMENT_VARIABLES.md) |
| 活動ログ（週次まとめ・カレンダー）の設計 | [`docs/activity-log.md`](docs/activity-log.md) |
| 表示速度とキャッシュの実測 | [`docs/perf-cache.md`](docs/perf-cache.md) |

`docs/tasks.md` / `docs/change-log.md` / `docs/dev-assignments.md` は **2026-08-11 で終わった
進め方の記録**（履歴として残しているだけ）。新しい作業をそこに足さないこと。

## 構成

```
apps/
  web/    Next.js本体（Vercelにデプロイ）
  bot/    Discord Bot（常駐運用）
packages/
  db/     Prismaスキーマ（web/botで共有）
  config/ 共通ESLint/TypeScript設定
tools/
  local-test/  本番ビルドのまま通しで確認する一式（CIもこれを流す）
```

## セットアップ

```bash
pnpm install
cp .env.example apps/web/.env.local   # 各値を設定（ルートの .env ではない）
pnpm db:push                          # DBスキーマを反映
```

**`pnpm db:push` は直接接続（5432番）で流れる。** `schema.prisma` の `directUrl` が
`DATABASE_DIRECT_CONNECT` を見ているため。プーラー経由だと**エラーも出さずに固まる**
（詳しくは `CLAUDE.md`）。

**スキーマを変えたら push を忘れないこと。** Vercelはコードだけをデプロイするので、
テーブルは自動では作られない。

```bash
pnpm dev:web    # Webを起動 (http://localhost:3000)
pnpm dev:bot    # 別ターミナルでBotを起動
```

### 招待メンバーの登録

このアプリはクローズド運用（許可リストに登録されたアカウントのみログイン可）です。

2人目以降は、**設定 → 許可リスト**の画面から追加・削除できます。この画面を使えるのは
環境変数 `ADMIN_EMAILS`（カンマ区切り）に載っているアカウントだけなので、先に自分の
メールアドレスを設定しておいてください。

最初の1人（＝自分）はまだログインできないため、スクリプトで登録します。
`packages/db/seed-allowlist.ts` のDiscordユーザーIDを書き換えてから実行してください：

```bash
pnpm --filter @gamers-highlight/db seed:allowlist
```

新しいメンバーがグループに入るまでの流れ：

1. 許可リストに追加する（この画面 or 上記スクリプト、またはグループの招待リンク）
2. 本人がDiscordでログインする
3. 既存メンバーがグループの「メンバー」から招待する

2を挟まないと3の招待候補に出てこない点に注意してください（招待は登録済みユーザーから選ぶため）。
招待リンクを使った場合は1と3がまとめて済みます。

## テスト

外部APIもストレージも本物には触らず、**本番ビルドのまま**通しで確認する一式が
`tools/local-test/` にあります。PRとmasterへのpushでは
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) が同じものを流します。

```bash
node tools/local-test/run-all.mjs   # 全スイート＋docs/test-results.md の作り直し
```

準備（Postgresの起動・スキーマ投入・模擬ストレージ）を含む手順は
[`tools/local-test/README.md`](tools/local-test/README.md) にあります。

## 定期実行

Vercel Cron を2本使っています（Hobbyプランは1日1回まで）。

| パス | 時刻(UTC) | 何をするか |
|---|---|---|
| `/api/cron/check-wishlist-prices` | `0 0 * * *` | ウィッシュリストの価格チェックと最安値更新の通知 |
| `/api/cron/check-bot-health` | `0 12 * * *` | Botの死活監視・無料枠の使用量・活動ログの日次ロールアップ・週次まとめの通知 |

**新しい定期処理は、枠を増やすのではなく既存のジョブに相乗りさせること。**

## 前提

- Node.js 20+
- pnpm 9+
- PostgreSQL（Supabase）
- Cloudflare R2 または S3互換ストレージ
- Discord Developer Portalで作成したBotアプリケーション
