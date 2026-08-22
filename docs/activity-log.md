# 活動ログの設計（週次まとめ／タイムライン・カレンダー）

**なぜその形にしたか**の記録。作りを変えたらこのファイルも直すこと。

**いまどこまで入っているか**（2026-08-22）

| | 状態 |
|---|---|
| `ActivityLog` / `DailyActivity` のテーブル | **入った**（`prisma db push` が必要） |
| 書き込みハンドラからの記録（`logActivity`） | **入った**。漏れは `audit-activity-log.mjs` がCIで見る |
| 既存データの遡り投入 | **入った**（`pnpm --filter @gamers-highlight/db backfill:activity`） |
| 管理画面の週次サマリー | **入った**（`/admin/weekly`。グループ×週を選んで、送る文面をそのままプレビュー） |
| 日次ロールアップ・1年より古い行の削除 | まだ（`DailyActivity` は空のまま） |
| Discordへの週次通知 | まだ |

きっかけは「週次のサマリーをDiscordへ流したい。まず管理画面で見てみたい」という要望。
ただし [`roadmap.md`](./roadmap.md) の Phase 5 に**タイムライン／カレンダー**が残っているので、
**同じデータで両方まかなえる形**にしてから作る。

---

## 1. なぜ新しいテーブルが要るのか

「追加された数」は既存の `createdAt` で今日から数えられる（しかも過去に遡れる）。

| 数えたいもの | 既存の列で足りるか |
|---|---|
| 写真・アルバム・ゲーム・提案・❤️・👀 の**追加** | **足りる**（各テーブルの `createdAt`） |
| メンバーの加入 | 足りる（`GroupMember.acceptedAt`） |
| ゲームの**ステータス変更**（今週クリアした） | **無理** |
| 写真・❤️ の**削除** | **無理**（行ごと消える） |
| 説明の**編集回数** | **無理**（1枚1列の上書き） |

**無理な3つのためだけに作る。** 既存の `createdAt` で足りるものを、わざわざログ経由に
置き換えない（置き換えると、ログを入れる前の過去が数えられなくなる）。

とくに `GroupGame.updatedAt` は**変更検出に使えない**。日次cronの `check-wishlist-prices` が
`lastPriceCheckedAt` を毎日書き込むため、`@updatedAt` がウィッシュリストのゲームで毎日動く。

---

## 2. 決まっていること（2026-08-22 ユーザー判断）

- **生ログの保持は1年。** それより古い行は日次cronで削除する
- **日次ロールアップは永久保存。** カレンダーの「その日どれくらい動いたか」はこれで描く
- 実ユーザーがいる状態でのスキーマ変更を許可。新規テーブルのみなので既存データには触らない

---

## 3. 時刻を2つ持つ（この設計の要）

**`occurredAt`（実世界でいつ起きたか）と `createdAt`（システムがいつ記録したか）を分ける。**

去年撮ったスクショを今日まとめて上げる、というのは普通に起きる。このとき、

- カレンダーは**去年のその日**に置きたい → `occurredAt`（写真なら `capturedAt`）
- 週次まとめは**今週の投稿**として数えたい → `createdAt`

1つしか持たないと必ずどちらかが壊れる。**後から足すと過去ぶんを埋め直せない**
（写真は `capturedAt` から復元できるが、他は推測になる）ので、最初から2つ持つ。

Discord取り込みも同じ（メッセージの投稿時刻 と 取り込み時刻）。

書き込み時に `occurredAt` を確定させる。写真なら `capturedAt ?? createdAt`。

---

## 4. スキーマ

```prisma
/// 出来事の記録。週次まとめとタイムライン／カレンダーの両方がここを読む。
/// **1年で消す**（古い日の詳細は消えるが、件数は DailyActivity に残る）。
model ActivityLog {
  id         String   @id @default(cuid())
  groupId    String?  // 非正規化。対象が消えた後でも辿れるように
  actorId    String?  // 誰が。退会・削除に備えてFKは張らない
  kind       String   // "photo.created" など。§5参照
  targetId   String   // 対象のレコードID
  targetName String?  // 消えた後も名前を出せるように控える
  detail     Json?    // {from:"PLAYING", to:"COMPLETED"} 程度
  occurredAt DateTime // カレンダー用（実時刻）
  createdAt  DateTime @default(now()) // 週次まとめ用（記録時刻）

  @@index([groupId, occurredAt]) // カレンダー: 月の範囲
  @@index([groupId, createdAt])  // 週次: 期間集計
  @@index([createdAt])           // 保持期間の削除用
  @@map("activity_logs")
}

/// 日次ロールアップ。**永久に残す。** 1グループ1日1種類につき1行。
model DailyActivity {
  groupId String
  date    DateTime @db.Date // JST基準の日付（§8）
  kind    String
  count   Int

  @@id([groupId, date, kind])
  @@map("daily_activities")
}
```

**`ActivityLog` に外部キーを張らない。** 張ると写真を消したときにカスケードでログごと消え、
「今週5枚消えた」という記録が消える。`targetName` を控えるのも同じ理由で、
IDしか無いと対象が消えた瞬間に何のことか分からなくなる。

---

## 5. `kind` の一覧

**テーブル名ではなくイベント名にする。** テーブル名だと、読む側が毎回
「テーブル→意味」の変換表を持つことになる。`<対象>.<過去形>` で揃える。

| kind | occurredAt | detail |
|---|---|---|
| `photo.created` | `capturedAt ?? createdAt` | `{mediaType, source}` |
| `photo.deleted` | 削除時刻 | — |
| `photo.description_set` | 更新時刻 | `{first: true/false}`（新規か書き直しか） |
| `photo.description_cleared` | 更新時刻 | — |
| `photo.reaction_added` | 押した時刻 | — |
| `photo.reaction_removed` | 取り消した時刻 | — |
| `album.created` | 作成時刻 | — |
| `album.deleted` | 削除時刻 | — |
| `game.added` | 追加時刻 | `{status}` |
| `game.status_changed` | 変更時刻 | `{from, to}` ← **今週クリアしたゲーム** |
| `game.removed` | 削除時刻 | — |
| `game.interest_added` / `game.interest_removed` | その時刻 | — |
| `proposal.created` | 作成時刻 | — |
| `proposal.voted` | 投票時刻 | `{type: LIKE/MAYBE/PASS}` |
| `proposal.vote_removed` | 取り消した時刻 | `{type}` |
| `proposal.accepted` | 過半数に達した時刻 | `{likeCount, threshold}` |
| `proposal.withdrawn` | 取り下げた時刻 | — |
| `member.joined` | `acceptedAt` | — |

足すときはこの表に追記する。**表に無い `kind` を書かない**（集計側が知らない値を
黙って捨てるか、逆に「不明」として出すかで揉めるため）。

---

## 6. どうやって記録するか

**`logActivity()` を書き込みハンドラから明示的に呼ぶ。** Prismaの `$extends` で
全書き込みを自動的に横取りする案は**採らなかった**。理由は2つ。

1. **`groupId` を解決できない。** 拡張が見えるのはモデルと引数だけなので、
   `PhotoReaction` から所属グループを知るには 写真→アルバム→グループ と辿り直すことになる。
   本番は1クエリ＝1往復（`perf-cache.md`）なので、全書き込みに往復が増える
2. **ノイズが混ざる。** `ApiUsage`・`BotHeartbeat`・`ErrorReport`・`ExternalGameCache` の
   更新まで入る。除外リストで消せるが、除外の管理は結局手作業になる

**ハンドラ側は `groupId` をほぼ無料で持っている。** `hasAlbumPermission()` が権限判定の中で
`album.groupId` を読んでいる（読んで捨てている）ので、これを返す形にすれば追加クエリはゼロ。

### 呼び忘れ対策

明示的に呼ぶ方式の弱点は**呼び忘れ**で、このリポジトリは `revalidateTag` の呼び忘れで
一度やらかしている。同じ対策を使う: **`audit-invalidation.mjs` と同じ静的チェック**を足し、
「書き込みハンドラなのに `logActivity()` を呼んでいない」をCIで落とす。
意図的に記録しないハンドラには、`audit-invalidation.mjs` と同じく**宣言の印**を置く
（黙って対象外にすると、本当の呼び忘れと区別がつかなくなる）。

判定は**import文と呼び出し**を見ること。素の文字列一致だとコメント中の単語に当たる
（`cacheTags` で実際に踏んだ）。

### 往復を増やさない

ログの挿入を別に投げると全書き込みが1往復増える。
**`$transaction([本体, ログ])` で1往復にまとめる。** 実装したら
`tools/local-test/query-count.mjs` で前後を測って `perf-cache.md` に残す。

---

## 7. 既存データの遡り投入

ログは入れた日から溜まり始めるので、**投入時に1回だけ既存テーブルから流し込む**。
これをやらないとカレンダーが最初の1年スカスカになる。

| kind | 元 |
|---|---|
| `photo.created` | `Photo`（`occurredAt = capturedAt ?? createdAt`） |
| `album.created` | `Album.createdAt` |
| `game.added` | `GroupGame.createdAt` |
| `proposal.created` | `GroupGameProposal.createdAt` |
| `proposal.voted` | `GroupGameProposalReaction.createdAt` |
| `photo.reaction_added` | `PhotoReaction.createdAt` |
| `game.interest_added` | `GroupGameInterest.createdAt` |
| `member.joined` | `GroupMember.acceptedAt` |

**遡れないもの**: 削除・ステータス変更・説明の編集履歴。これらは投入日から先だけ。

遡り投入は**何度流しても同じ結果になるように**書いてある（途中で失敗したら流し直せばよい）。

```bash
pnpm --filter @gamers-highlight/db backfill:activity
```

突き合わせの鍵は **`kind` + `targetId` + `actorId`**。`targetId` だけだと、1つの提案に
複数人が投票している場合や1枚の写真に複数人が❤️を押している場合に、
**1件でも入っていると残り全員ぶんが飛ばされる**。

（ローカルのシードで実測: 1回目は21件を投入、2回目は「すべて投入済み」で21件のまま）

---

## 8. 保持と日付の境界

- 生ログは**1年**。日次cron（`check-bot-health` に相乗り。cron枠は2つとも埋まっている）で
  `createdAt < now-1年` を削除する
- ロールアップは**永久**。同じ日次cronで前日ぶんを集計して1行にまとめる

**日付の境界はJST。** ユーザーも投稿も日本時間で動くので、UTCで切ると
「夜中に上げた写真が前日扱い」になる。`DailyActivity.date` はJSTの日付を入れる。
（`ApiUsage.date` がUTC基準なのは、YouTubeのクォータのリセットに合わせているため。
**同じ `@db.Date` でも基準が違う**ので混同しないこと。）

---

## 9. 読む側の使い分け

| 用途 | 読むもの | 並べる軸 |
|---|---|---|
| 週次まとめ（管理画面・Discord） | `ActivityLog` | `createdAt`（その週に記録されたもの） |
| カレンダーのヒートマップ | `DailyActivity` | `date` |
| カレンダーの日をクリック | `ActivityLog` ＋ `Photo` 本体 | `occurredAt` |
| タイムライン（時系列に流す） | `ActivityLog` ＋ `Photo` 本体 | `occurredAt` |

**カレンダーの主役は写真そのもの**（`Photo.capturedAt`）で、これは本体テーブルにあるから
1年で消えない。ログが消えて失われるのは「その日の出来事の注釈」だけ。

---

## 9-2. 週次まとめの決め事（`lib/weeklySummary.ts`）

- **週はJSTの月曜0時〜日曜24時。** UTCで切ると日曜の夜9時以降の投稿が翌週に落ちる。
  境界は `jstWeekRange()` の1箇所だけで決めている（`tools/local-test/flows.mjs` の
  F101・F102 が、月曜0時ちょうどと その1ミリ秒前 で確かめている。
  **テスト側は Intl から別実装で境界を出している**——同じ式をコピーすると、
  式が間違っていても両方同じように間違って何も確認できないため）
- **画面のプレビューと通知は同じ関数（`formatWeeklySummaryText`）を通す。**
  別々に組み立てると、整えた文面と実際に飛ぶ文面がずれる
- **見出しに「今週」と書かない。** 通知は週明けに終わった週を送るので、
  届いた時点では先週になっている。期間そのものを出せばいつ読んでも正しい
- **0件の週は送らない**（`hasActivity`）。毎週鳴ると読み飛ばされ、本当に見てほしい週に効かなくなる
  （`usageAlerts` と同じ思想）。管理画面では「送らない扱いになります」と明示する
- ❤️の集計は**取り消しを差し引いていない**。週の中で付けて外した分も1件として数える

## 10. 先に決めておく落とし穴

- **トグルは純増しか見えない。** ❤️は押し直しで行が消えるので、
  `reaction_added` と `reaction_removed` の両方を記録しないと「30件」が実際には
  35付いて5取り消された結果かもしれない。両方記録する
- **キャッシュを飛ばさない。** ログの書き込みで `revalidateTag` を呼ばないこと。
  ❤️を意図的にキャッシュに載せていない判断（`CLAUDE.md`）と同じ理由で、
  ログのために写真のキャッシュが飛んだら本末転倒
- **管理画面のセクションは独立して失敗させる。** `/admin` はテーブル未作成で
  全体が500になった前科がある。`Promise.allSettled` で握りつぶす
- **テストは2回流して同じ結果になること。** ログは書き込みのたびに増えるので、
  件数を絶対値で断定するテストは通しで流すと落ちる（`lessons.md`）
- **未分類の写真は `groupId` が決まらない。** Discord経由で未分類のまま取り込まれた写真は
  アルバムに属さないので、投稿の時点では「どのグループの出来事か」が決まらない
  （権限を判定する足場が無いのと同じ理由）。放置すると**その投稿がグループの週次まとめに
  一生出てこない**。振り分けが決まった時点（`photos/assign-album`・`discord/tag`・
  `internal/assign-game`）で既存の行の `groupId` を埋め直している。
  **新しい行は作らない**——作ると同じ投稿が2件に数えられる

---

## 11. やらないこと

- **既存の `createdAt` 集計をログに置き換えない**（§1）
- **差分（before/after の全列）を持たない。** `detail` に入れるのは集計と表示に要る分だけ。
  監査ログではないので、全列を残す価値に対してサイズが見合わない
- **ユーザー個人の行動追跡には使わない。** 見せるのは「グループの活動」であって、
  誰が何を見たかは記録しない（そもそも読み取りは記録しない）
