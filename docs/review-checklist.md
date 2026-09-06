# レビューチェックリスト（自動レビュー用）

このプロジェクト（ShareStaq）で**過去に実際に問題が起きた**ポイント。
自動レビューはこのリストと照らして差分をチェックする。

**足すのは一度やらかしたことだけ。** 背景は [`CLAUDE.md`](../CLAUDE.md)（コードの落とし穴）と
[`lessons.md`](./lessons.md)（進め方の落とし穴）にある。

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
- [ ] 画像15MB / 動画100MB・2分以内のバリデーションを守っているか（`apps/web/src/lib/media-limits.ts` を迂回して数値をベタ書きしていないか。Bot側の写し `apps/bot/src/lib/mediaLimits.ts` と揃っているか）

## 5. モノレポ・パッケージ管理
- [ ] pnpmワークスペースの構成（`apps/*`, `packages/*`）を崩していないか
- [ ] `package.json` のスクリプトが pnpm 前提のまま保たれているか（npm/yarn形式に化けていないか）

## 6. キャッシュと権限
- [ ] 書き込みハンドラで `lib/cacheTags.ts` の無効化関数を呼んでいるか（**`revalidateTag` を直接書かない**）。
      1箇所でも呼び忘れると「投稿したのに一覧に出ない」が起き、時間では直らない
- [ ] 逆に、GETに無効化を混ぜていないか（読むたびにキャッシュを捨てることになる）
- [ ] キャッシュキーにユーザーを入れていないか。**中身のキャッシュと権限判定は分ける**
      （権限は毎回サーバーで `hasAlbumPermission` / `hasGroupPermission` を通す）
- [ ] IDを受け取るページで、**ページ側でも**権限を判定しているか。
      APIが403でもServer Componentのページは素通りする（実際に他人のアルバムが見えていた）
- [ ] `(main)` 配下にページを足したなら `src/middleware.ts` の matcher にも足したか
- [ ] `unstable_cache` に包んだ関数が `Date` をそのまま返していないか（**キャッシュヒットの回だけ**
      ISO文字列になり、`.toISOString()` が落ちる）

## 7. 記録と外部への書き込み
- [ ] 書き込みハンドラで `logActivity()` / `activityLogCreateArgs()` を呼んでいるか。
      意図的に記録しないなら、その旨を印で宣言しているか（`audit-activity-log.mjs` が見る）
- [ ] `ACTIVITY_KINDS` に無い `kind` を書いていないか（足すなら `docs/activity-log.md` §5 にも）
- [ ] 外部APIの取得結果を保存するとき、**失敗を「取得済み」として確定させていないか**
      （行の有無だけで判断すると、たまたま落ちていた項目が永久に空欄で固定される）
- [ ] Discordへの投稿など**外部への書き込みの後に状態を進める**処理で、
      失敗しても進めていないか（`postDiscordMessage` は例外を投げず `false` を返す）
- [ ] YouTube の `search.list` をページ表示のたびに呼んでいないか（無料枠は実質100回/日）

## 8. 日付とタイムゾーン
- [ ] JSTの日付を `@db.Date` に入れるとき `jstDateColumn()` を通しているか
      （**切り捨てはUTCで行われる**ので、そのまま渡すと前日として保存される）
- [ ] 「その日」「その週」の境界をJSTで切っているか（UTCで切ると夜の投稿が前日扱いになる）

## 9. 一般的なコード品質
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
