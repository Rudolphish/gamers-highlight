# レビューチェックリスト（自動レビュー用）

このプロジェクト（Gamer's Highlight）で過去に問題が起きたポイント。
自動レビューはこのリストと照らして差分をチェックする。

## 1. デプロイ・環境まわり（最重要）
- [ ] `.npmrc` の `node-linker=hoisted` を削除・変更していないか
- [ ] Prisma の engine type が `library` のままか（`binary` に変えていないか）
- [ ] `next.config` の `serverComponentsExternalPackages` / `outputFileTracingRoot` を壊していないか
- [ ] `DATABASE_URL` の接続先が Supavisor pooler（6543番、`pgbouncer=true`）のままか
- [ ] NextAuth のルートに `export const dynamic = "force-dynamic"` が残っているか

## 2. データ・スキーマ
- [ ] `packages/db/schema.prisma` の変更は破壊的でないか（既存カラムの削除・型変更で過去データが壊れないか）
- [ ] マイグレーションではなく `db push` 前提の運用なので、本番に直接影響する変更でないか

## 3. 認証・アクセス制御
- [ ] 許可リスト（`AllowlistEntry`）による招待制ログインのロジックを壊していないか
- [ ] `auth.ts` に不要な認証バックドアや条件緩和が追加されていないか

## 4. アップロード制約
- [ ] 画像15MB / 動画30MB・30秒以内のバリデーションを守っているか（`apps/web/src/lib/media-limits.ts` 相当の一元ロジックを迂回していないか）

## 5. モノレポ・パッケージ管理
- [ ] pnpmワークスペースの構成（`apps/*`, `packages/*`）を崩していないか
- [ ] `package.json` のスクリプトが pnpm 前提のまま保たれているか（npm/yarn形式に化けていないか）

## 6. 一般的なコード品質
- [ ] TypeScriptの型エラーがないか
- [ ] 明らかなデッドコード・console.logの残置がないか
- [ ] エラーハンドリングが握りつぶされていないか（catchで無言でreturnしていないか等）

---

## 出力フォーマット（自動レビューが従う形式）

レビュー結果は必ず最初の行に以下のいずれかを書くこと：

```
VERDICT: PASS
```
または
```
VERDICT: FAIL
```

FAILの場合は、その後に箇条書きで具体的な修正指示を書くこと（ファイルパスと直すべき内容を明記）。
