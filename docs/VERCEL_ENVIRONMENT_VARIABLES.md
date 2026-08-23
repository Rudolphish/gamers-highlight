# Vercel環境変数

以下は `apps/web` を Vercel にデプロイする際に必須の環境変数です。
ローカル用のひな形は[`.env.example`](../.env.example)にあります（`apps/web/.env.local` へコピーする）。

**環境変数ではないもの**（`AppSetting` テーブルに持たせているので、Vercel側の設定は不要です）:
エラー通知先チャンネル（`errorNotifyChannelId`）と週次まとめの通知先（`weeklySummaryChannelId`）。
**再デプロイせずに変えられるように**画面（`/admin/errors`・`/admin/weekly`）から設定します。

- `DATABASE_URL` — Supavisor プーラー（6543番、`pgbouncer=true`）を指すこと。直接接続にするとサーバーレスで接続数を食い潰す
- `DATABASE_DIRECT_CONNECT` — Supabaseの直接接続文字列（5432番）。`schema.prisma` の `directUrl` が参照し、`prisma db push` / `migrate` はこちらを使う（プーラー経由だとハングするため）。**マイグレーションはローカルから実行するので Vercel 側には不要**。未設定でも `prisma generate` は成功するのでビルドは通る（実測済み）
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (通常は自動設定されるが、手動で設定しても安全)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `ADMIN_EMAILS` — 下の「追加の運用向け変数」に説明あり。**未設定だと管理画面を誰も操作できない**ので、実質必須

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
- `CRON_SECRET` — Vercel Cron Jobsからの `/api/cron/*` 呼び出しを認証するための秘密値。ローカルで生成した値をVercel側にも設定 設定済み（2026-08-08）。cronは2本ある（`check-wishlist-prices` … 価格チェック／`check-bot-health` … Bot死活監視・無料枠の使用量・活動ログの日次ロールアップ・週次まとめの通知）。**Hobbyプランは1日1回までなので、新しい定期処理はこの2本に相乗りさせること**
- `ADMIN_EMAILS` — 管理者のメールアドレス（カンマ区切り、例: `you@example.com,friend@example.com`）。設定画面の「許可リスト」タブと `/admin` の全タブ（使用量・ユーザー・週次まとめ・活動カレンダー・招待リンク・メディア一覧・エラー）を使える人を指定する。**未設定だと誰もこれらの画面を操作できない**（フェイルクローズ）ため、自分のアドレスを入れておくこと。ここに書くのは「管理できる人」であり、アプリを使える人の一覧ではない（そちらは許可リスト自体で管理する）

管理者ページの使用率表示に使う上限値（任意。未設定なら無料枠の目安を使う）:

- `STORAGE_LIMIT_BYTES` — R2の容量上限。既定は10GB（無料枠）
- `DATABASE_LIMIT_BYTES` — DBの容量上限。既定は0.5GB（Supabase無料枠）

プランを上げた場合はここを実態に合わせること。分母がずれていると使用率の数字を見て誤った判断をすることになる。
