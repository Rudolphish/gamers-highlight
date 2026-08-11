# ShareStaq

Discordに流れていくゲームのスクリーンショットを自動で拾い集め、ゲームごとに整理・共有できるWebアプリ。

詳細な技術仕様は `docs/spec.md` を参照してください。

## 構成

```
apps/
  web/    Next.js本体（Vercel等にデプロイ）
  bot/    Discord Bot（Railway/Fly.io等で常駐運用）
packages/
  db/     Prismaスキーマ（web/botで共有）
  config/ 共通ESLint/TypeScript設定
```

## セットアップ

```bash
pnpm install
cp .env.example .env   # 各値を設定
pnpm db:push            # DBスキーマを反映
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

1. 許可リストに追加する（この画面 or 上記スクリプト）
2. 本人がDiscordでログインする
3. 既存メンバーがグループの「メンバー」から招待する

2を挟まないと3の招待候補に出てこない点に注意してください。

```bash
pnpm dev:web             # Webを起動 (http://localhost:3000)
pnpm dev:bot              # 別ターミナルでBotを起動
```

## 前提

- Node.js 20+
- pnpm 9+
- PostgreSQL（Supabase等）
- Cloudflare R2 または S3互換ストレージ
- Discord Developer Portalで作成したBotアプリケーション
