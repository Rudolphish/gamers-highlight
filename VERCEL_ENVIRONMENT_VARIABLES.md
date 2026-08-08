# Vercel環境変数

以下は `apps/web` を Vercel にデプロイする際に必須の環境変数です。

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (通常は自動設定されるが、手動で設定しても安全)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`

（GoogleログインOAuthは2026-08-07に削除済み。`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`はVercel側にも不要）

OAuthリダイレクトURIの例:

- Discord: `https://YOUR_DOMAIN/api/auth/callback/discord`

追加の運用向け変数:

- `STORAGE_ENDPOINT`
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- `STORAGE_PUBLIC_URL`
- `INTERNAL_API_BASE_URL`
- `INTERNAL_API_SECRET`
- `DISCORD_BOT_TOKEN` — apps/bot用だが、apps/web側でもDiscord REST APIへの直接投稿（最安値更新通知のcronジョブ）に同じトークンを使うため必須
- `ITAD_API_KEY` — IsThereAnyDeal API（ゲーム詳細ページの価格情報、最安値更新通知の判定に使用）設定済み（2026-08-08）
- `YOUTUBE_API_KEY` — YouTube Data API v3（ゲーム詳細ページの関連動画）設定済み（2026-08-08）
- `CRON_SECRET` — Vercel Cron Jobsからの`/api/cron/check-wishlist-prices`呼び出しを認証するための秘密値。ローカルで生成した値をVercel側にも設定 設定済み（2026-08-08）
