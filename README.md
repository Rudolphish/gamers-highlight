# Gamer's Highlight

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

### 招待メンバーの登録（初回のみ）
このアプリはクローズド運用（許可リストに登録されたアカウントのみログイン可）です。
`packages/db/seed-allowlist.ts` のDiscordユーザーIDを書き換えてから実行してください：

```bash
pnpm --filter @gamers-highlight/db seed:allowlist
```

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
