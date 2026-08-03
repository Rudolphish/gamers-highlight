# 開発分担（Claude / VSCodeエージェント 並行開発用）

複数のエージェント（Claude、VSCodeのコーディングエージェント等）でリミットを分散しながら並行開発するための役割分担。**コンフリクトを避けるため、担当外のファイルには触れない**ことを原則とする。

## 進め方の原則

1. 作業前に、このドキュメントで自分のトラックの担当範囲を確認する
2. 機能ごとにブランチを切る（例: `feature/search`, `feature/settings-page`）。mainへの直接pushはできるだけ避け、機能が完結してから統合する
3. 「共有ファイル」（下記）に変更が必要になった場合は、着手前にこのドキュメントの「共有ファイルの変更ログ」に一言残してから触る
4. 1機能・1PR（または1まとまりのコミット群）で完結させ、中途半端な状態でmainに残さない
5. 作業を始める・終えるタイミングでこのファイルの該当セクションにステータスを追記する（進行中 / 完了 / 保留）

## ツール割り当てとレビューフロー

本プロジェクトでは2つのAIツールを併用している（Continue.devは廃止しClineに一本化）：

- **Claude**（このチャット）：設計判断、複数ファイル横断の原因調査、ドキュメント化、**Clineの成果物レビュー**
- **Cline + ローカル LLM**：[`tasks.md`](./tasks.md)に定義された、小さく分割されたタスクを順番に実行

> 以前Continue.devとClineに役割を分けていたが、両方ともローカル LLMを使う以上 APIのリミット分散という当初の目的には寄与しないことが分かったため、Clineに一本化した。ただしClineは自律実行の度合いが強い分、ローカル LLMの性能次第で暴走しやすい（実際にT-B1でビルドを壊す失敗事例があった）。そのため`tasks.md`ではタスクを従来よりかなり細かく分割し、厄守事項を明記している。

### レビューの回し方

1. Clineが[`tasks.md`](./tasks.md)のタスクを実装し、完了条件の自己チェックを行った上で[`change-log.md`](./change-log.md)に記録する
2. `tasks.md`のステータスを「完了報告あり（レビュー待ち）」に更新する
3. Claudeが`change-log.md`の記載と実際のコード差分を照らし合わせ、完了条件を満たしているか確認する
4. 問題なければ`tasks.md`のステータスを「完了」にする
5. 修正が必要なら、元のタスクフォーマットを踏襲した・何が足りないか/間違っているかを明記した**再修正タスク**（タスクタイトル例: `T7-fix1`）を`tasks.md`に追加し、元のタスクのステータスを「差し戻し（再修正タスク: T-XX-fix1参照）」にする

---

## 実装タスクの一覧

検索・ライトボックス・設定ページなど、Clineに割り当てている現在進行中のタスクはすべて[`tasks.md`](./tasks.md)（T1〜T10）に集約している。進捗確認はそちらを参照すること。

## Track B：アルバム管理・共有系（完了済み・履歴）

| 機能 | 対象ファイル（新規/変更） |
|---|---|
| アルバム作成画面 | `app/(main)/albums/new/page.tsx`（完了）、`app/api/albums/route.ts`（zodバリデーション追加済み） |
| 共有設定モーダル（メンバー招待） | `components/album/ShareModal.tsx`（完了、権限変更・削除も対応）、`app/api/albums/[id]/members/*`（完了） |
| モバイル表示調整 | 未着手（必要になったら別途） |

## Track C：信頼性・セキュリティ改善（Claudeが自主的に追加）

**ステータス：完了**（2026-08-03）

Track Aが未着手の間、被らない範囲でバックエンドの堂牢化を進めたトラック。

| 機能 | 対象ファイル |
|---|---|
| アルバム詳細/写真一覧APIの認証漏れ修正 | `app/api/albums/[id]/route.ts`、`app/api/albums/[id]/photos/route.ts`（未ログインでもアルバムIDが分かれば中身が見えてしまう状態を修正） |
| 画像ドメイン制限 | `apps/web/next.config.js`（`hostname: "**"` → R2の実ドメインに絞り込み） |

**位置づけ**：上記は`tasks.md`のT1（検索APIの権限フィルタ）とは別のファイルを対象としており重ならない。T1で同じような権限チェックを実装する際は、ここで修正した`app/api/albums/[id]/route.ts`等の実装を参考にできる。

---

## 共有ファイル（触る前に一声かける・変更ログに追記すること）

以下は複数の機能から参照される可能性が高いファイル。変更する場合は、このセクションに「日時・担当トラック・変更内容」を追記してから作業すること。

- `packages/db/schema.prisma`（DBスキーマ変更はどちらか一方が行い、変更後は速やかに `pnpm db:generate` の再実行とpushをもう一方に共有する）
- `apps/web/src/components/layout/Sidebar.tsx`（ナビゲーション項目の追加）
- `apps/web/src/lib/permissions.ts`（権限ロジック）
- `apps/web/tailwind.config.js` / `apps/web/src/app/globals.css`（デザイントークン）
- `.env.example` / Vercel環境変数一覧

### 変更ログ

| 日時 | トラック | 変更内容 |
|---|---|---|
| （記入例）2026-08-03 | Track A | schema.prismaに`Photo.viewCount`追加、pnpm db:generate済み |
| 2026-08-03 | Track B | アルバム作成画面、共有設定モーダル（メンバー招待・権限変更・削除）を実装。`api/users`と`api/albums/[id]/members/[userId]`を新規追加（どちらもTrack B専用の新規ファイルのため共有ファイル変更には該当しないが念のため記載）。schema.prismaは不変。 |
| 2026-08-03 | Track C | `apps/web/next.config.js`のimages.remotePatternsを`hostname: "**"`からR2の実ドメイン（`pub-*.r2.dev`、`*.r2.cloudflarestorage.com`）に絞り込み。Prisma関連の既存設定（outputFileTracingRoot等）は不変。 |

---

## 対象外（どちらのトラックも触れない・別途相談）

- Discord Bot（`apps/bot/*`）：現状 Phase 0 の残タスクなし。今後動きがあれば別トラックとして切り出す
- `apps/web/src/app/api/discord/*`（ingest・channel-mappings・link）：Bot連携の根幹なので変更が必要な場合は事前相談
- 認証まわり（`apps/web/src/lib/auth.ts`、`middleware.ts`、`app/(auth)/*`）：稼働中のためむやみに触らない
