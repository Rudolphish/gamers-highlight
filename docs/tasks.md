# タスク一覧（Google AI Studio専用）

このファイルはGoogle AI Studioへの指示書として使う。各タスクには**完了条件**を明記しているので、実装後は完了条件を満たしているか自己確認し、[`change-log.md`](./change-log.md) に変更内容を記録すること。

## ⚠️ 厳守事項（すべてのタスク共通・最優先で守ること）

過去に、指示されていない新規ファイル・新規の型定義を勝手に作り、実在しないパスをimportしてビルドを壊した事例があった。同じ失敗を避けるため、以下を必ず守ること。

1. **タスクの「対象ファイル」に書かれているファイル以外は作成・変更しない。** 新しい型定義ファイル（`types/xxx.ts`等）や新しいユーティリティファイルを勝手に作らない
2. **既存のコンポーネント名・export方式（named export / default export）を変更しない。** 既存コンポーネントを別物に置き換えない
3. **新しい型を定義する必要が出てきたら、既存の似た型（同じファイル内、または近い場所にあるもの）をコピーして使う。** 実在しないファイルをimportしない
4. **importする前に、そのファイル・そのexportが実際に存在するか確認すること。** 存在しないパスをimportしない
5. 1タスクは原則1ファイルの変更に留める（例外は各タスクの記載に従う）
6. 前提タスクが指定されている場合、そのタスクが完了してから着手する
7. 完了条件を満たせない・仕様が曖昧で判断に迷う場合は、実装を進めずその旨を`change-log.md`に記録して報告する（推測で進めない）
8. タスク完了後、[`change-log.md`](./change-log.md) の末尾に、タスクIDをタイトルにして変更内容を追記する
9. 1タスク＝1コミット。コミットメッセージの先頭にタスクID（例: `[T1]`）を入れる
10. **タスクとして明示的に割り当てられていないファイルには絶対に手を出さない。** 特に`apps/web/src/lib/auth.ts`、`apps/web/src/lib/db.ts`、`middleware.ts`、`.npmrc`、ルート`package.json`は**複数回重大な事故**（認証バイパスの混入、DBエラーを隔蔽してフェイクデータを返す仕組みの混入、Vercelビルド設定の破壊）が起きている。**ビルドエラーや実行時エラーを目にしても、これらのファイルを自分の判断で修正してはいけない。** エラーの内容をそのまま`change-log.md`に報告して、Claudeの判断を仔がすこと

---

## T1：検索APIの権限フィルタ実装（バックエンドのみ）

- **対象ファイル**：`apps/web/src/app/api/photos/search/route.ts`（このファイルのみ変更。新規ファイル作成なし）
- **前提タスク**：なし
- **内容**：
  現在は誰の写真でも無条件に返している。ログインユーザーが閲覧権限（VIEWER以上）を持つアルバムの写真のみに絞り込む。
  - 既存の `apps/web/src/lib/permissions.ts` の `hasAlbumPermission(albumId, userId, role)` 関数をそのままimportして使う（この関数自体は変更しない）
  - `albumId` が `null`（未分類）の写真は、`uploaderId === 自分のuserId` の場合のみ結果に含める
  - ログインは `getServerSession(authOptions)` を使う（`apps/web/src/app/api/albums/route.ts` の GET 関数に同じパターンの実装例があるので参考にする）
  - `export async function GET(req: Request)` という関数シグネチャは変更しない
- **完了条件**：
  - [ ] 未ログインなら401を返す
  - [ ] 自分がメンバーでないアルバムの写真は結果に含まれない
  - [ ] 未分類（albumId無し）の写真は投稿者本人の検索結果にのみ含まれる
  - [ ] 既存のクエリパラメータ（game/uploader/from/to）の挙動は変えない

## T2：検索ページ - 静的なフォームUIのみ（API呼び出しなし）

- **対象ファイル**：`apps/web/src/app/(main)/search/page.tsx`（このファイルのみ）
- **前提タスク**：なし
- **内容**：
  ゲーム名・投稿者・開始日・終了日の入力欄と「検索」ボタンを持つフォームを実装する。**この段階ではAPI呼び出しは実装しない。** 送信ボタンを押したら `console.log()` で入力値を出すだけでよい
  - `"use client"` をファイル先頭に付ける
  - デザインは他の画面（`apps/web/src/app/(main)/upload/page.tsx` を参考）に合わせて `steam-*` のtailwindクラス・`font-mono`/`font-display` を使う
- **完了条件**：
  - [ ] 4つの入力欄（ゲーム名・投稿者・開始日・終了日）と検索ボタンが表示される
  - [ ] 入力・送信ができ、送信時にconsole.logで値が確認できる
  - [ ] ネットワークリクエストは一切発生しない

## T3：検索ページ - API連携・結果表示

- **対象ファイル**：`apps/web/src/app/(main)/search/page.tsx`（T2の続き。同じファイル）
- **前提タスク**：T2が完了していること
- **内容**：
  T2で作ったフォームの送信時に `GET /api/photos/search?game=&uploader=&from=&to=` を呼び出し、結果を表示する
  - 結果表示には既存の `apps/web/src/components/photo/PhotoGrid.tsx` の `PhotoGrid` コンポーネントをそのまま使う（**このコンポーネント自体は変更しない**）。`PhotoGrid` は `{ photos: Media[] }` という形のpropsを受け取る（`Media`型は`PhotoGrid.tsx`内で定義されているものと同じ形にする。新しい型ファイルは作らない）
  - フォーム未送信時（初期表示時）は全件（最大100件）を表示する
  - 検索結果が0件のときは「見つかりませんでした」のようなメッセージを表示する
- **完了条件**：
  - [ ] 初期表示で全件（最大100件）表示される
  - [ ] ゲーム名・日付範囲で絞り込みが効く
  - [ ] 0件時にメッセージが出る
  - [ ] `PhotoGrid.tsx`のファイル自体は変更していない

## T4：Discord連携設定ページ

- **対象ファイル**：`apps/web/src/app/(main)/settings/discord/page.tsx`（このファイルのみ）
- **前提タスク**：なし
- **内容**：
  `GET /api/discord/link` を呼んで連携状況を表示する。未連携なら「Discordでログインし直す」導線、連携済みならその旨を表示する。`/api/discord/link` のレスポンス形式は `apps/web/src/app/api/discord/link/route.ts` を見て確認する（**このAPIファイルは変更しない**）
- **完了条件**：
  - [ ] 連携済み/未連携で表示が切り替わる
  - [ ] `/api/discord/link`は変更していない

## T5：プロフィール設定API（バックエンドのみ）

- **対象ファイル**：`apps/web/src/app/api/users/me/route.ts`（新規作成。このファイルのみ）
- **前提タスク**：なし
- **内容**：
  - `GET`：ログイン中ユーザーの `id`・`name`・`email` を返す
  - `PATCH`：body `{ name: string }` を受け取り、`User.name` を更新する。空文字はzodでバリデーションして400を返す
  - ログイン確認は `apps/web/src/app/api/albums/route.ts` のGET関数と同じパターンを使う
  - `packages/db/schema.prisma` は変更しない（スキーマ変更が必要だと判断したら実装せず報告する）
- **完了条件**：
  - [ ] GETで自分の情報が取得できる
  - [ ] PATCHで名前が更新される
  - [ ] 未ログインなら両方とも401
  - [ ] 空文字での更新は400

## T6：プロフィール設定ページ（UI）

- **対象ファイル**：`apps/web/src/app/(main)/settings/profile/page.tsx`（新規作成。このファイルのみ）
- **前提タスク**：T5が完了していること
- **内容**：T5で作ったAPIを呼ぶだけのシンプルなフォーム（現在の名前を表示 → 編集 → 保存ボタン）
- **完了条件**：
  - [ ] 表示名を変更して保存すると反映される
  - [ ] 保存中はボタンが無効化される

---

## 写真拡大表示（ライトボックス）機能：T7〜T10に分割

**過去の失敗事例**：以前このタスクを1つの大きなタスクとして渡したところ、`Lightbox.tsx`の中身が丸ごと別コンポーネントに書き換えられ、存在しない`types/Photo`をimportしてビルドが壊れた。そのため、今回は**4段階に分割**し、各段階の完了時点で必ずビルドが通る状態を保つ。

### T7：PhotoGridに選択状態を追加（表示への反映はまだしない）

- **対象ファイル**：`apps/web/src/components/photo/PhotoGrid.tsx`（このファイルのみ）
- **前提タスク**：なし
- **内容**：
  `PhotoGrid`関数コンポーネント内に `useState<number | null>(null)` でクリックされた写真のインデックスを保持する状態を追加する。各サムネイルの`<div>`に`onClick`を追加し、クリックされたらそのインデックスをセットする。**この段階ではLightboxコンポーネントは使わない・importしない。** 動作確認用に `console.log(selectedIndex)` を入れてよい
  - `"use client"` をファイル先頭に追加する必要がある（現状は無いので追加すること）
  - 既存のexport（`export function PhotoGrid(...)`）の形は変えない。既存のprops型`Media`もそのまま使う
- **完了条件**：
  - [ ] サムネイルクリックでconsole.logにインデックスが出る
  - [ ] 既存の見た目（グリッド表示、動画バッジ等）は一切変わらない
  - [ ] `PhotoGrid`のexport方式・propsの型は変更していない

### T8：クリックした写真をLightboxで表示する

- **対象ファイル**：`apps/web/src/components/photo/PhotoGrid.tsx`（T7の続き。同じファイル）
- **前提タスク**：T7が完了していること
- **内容**：
  T7で保持している`selectedIndex`が`null`でないとき、`apps/web/src/components/photo/Lightbox.tsx`の`Lightbox`コンポーネント（**このファイルは今回変更しない、既存のまま**）を描画する。`Lightbox`は`{ mediaType, mediaUrl }`というpropsを受け取る（`Lightbox.tsx`を開いて確認すること）。`selectedIndex`に対応する`photos`配列の要素からこの2つの値を渡す
- **完了条件**：
  - [ ] サムネイルクリックでライトボックスが開き、拡大表示される
  - [ ] `Lightbox.tsx`のファイル自体は変更していない

### T9：Lightboxを閉じられるようにする

- **対象ファイル**：`apps/web/src/components/photo/Lightbox.tsx`（props追加）、`apps/web/src/components/photo/PhotoGrid.tsx`（閉じる処理を渡す）
- **前提タスク**：T8が完了していること
- **内容**：
  - `Lightbox.tsx`の`LightboxProps`型に `onClose: () => void` を追加する（既存の`mediaType`/`mediaUrl`は残す）
  - 背景の`<div>`のクリックと、右上に追加する×ボタンのクリックで`onClose`を呼ぶ
  - `useEffect`でキーボードの`Escape`キー押下時にも`onClose`を呼ぶ（`"use client"`が必要なら追加する）
  - `PhotoGrid.tsx`側で`Lightbox`に`onClose={() => setSelectedIndex(null)}`のようなpropsを渡す
- **完了条件**：
  - [ ] ×ボタン・背景クリック・ESCキーの3通りで閉じられる
  - [ ] 閉じた後、再度サムネイルをクリックすればまた開ける

### T10：前へ/次へナビゲーション

- **対象ファイル**：`apps/web/src/components/photo/Lightbox.tsx`（props追加）、`apps/web/src/components/photo/PhotoGrid.tsx`（前後移動の処理）
- **前提タスク**：T9が完了していること
- **内容**：
  - `Lightbox.tsx`の`LightboxProps`型に `onPrev?: () => void` と `onNext?: () => void` を追加し、渡された場合のみ左右に矢印ボタンを表示する
  - `PhotoGrid.tsx`側で、`selectedIndex`を±1する関数を用意し、`Lightbox`に渡す。配列の端では非活性にする（ループさせなくてよい）
- **完了条件**：
  - [ ] 前へ/次へボタンで同じ一覧内の写真を移動できる
  - [ ] 端（最初/最後）では該当ボタンが非活性になる

---

## T1-fix1：検索APIの権限フィルタ実装（T1の再修正）

- **対象ファイル**：`apps/web/src/app/api/photos/search/route.ts`（このファイルのみ）
- **前提タスク**：なし
- **背景**：T1で実装を試みた結果、存在しないファイルのimport、間違ったexport名の使用、Promiseに対する`.filter()`の誤用などでビルドが壊れた。今回は推測の余地をなくすため、**以下のコードをそのままファイル全体の置換内容として使用すること**。ロジックを自分で考え直さないでこの通りにすること
- **実施方法**：下記のコードブロックをファイル全体としてそのまま上書きする（部分置換ではなく全文置換でよい）

```ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// GET /api/photos/search?game=&uploader=&from=&to=
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email ? await db.user.findUnique({ where: { email: session.user.email } }) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const game = searchParams.get("game") ?? undefined;
  const uploaderId = searchParams.get("uploader") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const candidates = await db.photo.findMany({
    where: {
      gameTitle: game ? { contains: game, mode: "insensitive" } : undefined,
      uploaderId: uploaderId ?? undefined,
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // hasAlbumPermissionは非同期関数なので、Array.filter()の中では使わず
  // for文でひとつずつawaitして判定する
  const allowed = [];
  for (const photo of candidates) {
    if (photo.albumId) {
      const canView = await hasAlbumPermission(photo.albumId, user.id, "VIEWER");
      if (canView) allowed.push(photo);
    } else if (photo.uploaderId === user.id) {
      allowed.push(photo);
    }
  }

  return NextResponse.json({ photos: allowed });
}
```

- **完了条件**：
  - [ ] 上記コードをそのまま貼り付けてビルドが通る（`pnpm --filter web build` または`pnpm dev:web`でエラーが出ない）
  - [ ] 未ログインなら401を返す
  - [ ] 自分がメンバーでないアルバムの写真は結果に含まれない
  - [ ] 未分類（albumId無し）の写真は投稿者本人の検索結果にのみ含まれる
  - [ ] `@/types/Media`のような存在しないファイルをimportしていない
  - [ ] `hasAlbumPermission`を自作せず、`@/lib/permissions`からimportしたものを使っている

---

## ステータス一覧（Claudeがレビュー後に更新する）

| タスク ID | 前提タスク | ステータス                            |
| --------- | ---------- | ------------------------------------- |
| T1        | なし       | 差し戻し（再修正タスク: T1-fix1参照） |
| T1-fix1   | なし       | 完了（Claudeが直接修正）              |
| T2        | なし       | 完了 |
| T3        | T2         | 完了 |
| T4        | なし       | 完了（Claudeが直接実装） |
| T5        | なし       | 完了 |
| T6        | T5         | 完了 |
| T7        | なし       | 完了 |
| T8        | T7         | 完了 |
| T9        | T8         | 完了 |
| T10       | T9         | 完了 |

ステータスは `未着手` → `完了報告あり（レビュー待ち）` → `完了` または `差し戻し（再修正タスク: T-XX-fix1 参照）` の順で遷移する。**前提タスクが「完了」になるまで、後続タスクには着手しないこと。**

フェーズ1（T1〜T10）は全て完了。なお、T2〜T10の実施中に、タスク対象外の`apps/web/src/lib/auth.ts`、`.npmrc`、ルート`package.json`に重大な問題のある変更が**2回**加えられていたため、Claudeがその都度元の安全な状態に戻した（詳細は[`change-log.md`](./change-log.md)の「[Claudeレビュー]」項目を参照）。

---

## Phase 2：UIブラッシュアップ（`docs/ideas.md`より選定）

`docs/ideas.md`のアイデアのうち、低リスク・小規模なものを選んでタスク化した。**ドラッグ＆ドロップ整理UIとライトボックスの編集機能は今回のスコープ外**（Phase 2の実運用フィードバック後に判断）。

このセクションのタスクは、**すでに実装済みのコンポーネントへの差分追加**である。既存のロジック（クリックでライトボックスを開く、prev/next、close等）を絶対に壊さないこと。**これ以外のファイル（特に`auth.ts`やUI全体に関わるHeader/Sidebar等）は絶対に変更しないこと。**

### T11：ホバー時のネオン発光エフェクト強化

- **対象ファイル**：`apps/web/src/components/album/AlbumCard.tsx`、`apps/web/src/components/photo/PhotoGrid.tsx`（どちらも`className`のみ変更。ロジック・props・JSXの構造は一切変更しない）
- **前提タスク**：なし
- **内容**：
  両ファイルとも既に`hover:border-steam-blue`（枠線色変化）とズーム（`group-hover:scale-105`等）が入っている。これに加えて、ホバー時に浅い発光（box-shadow）を追加する。
  - 例: `hover:shadow-[0_0_16px_-2px_rgba(102,192,244,0.5)]` のようなクラスを、現在`hover:border-steam-blue`が付いている要素（`AlbumCard.tsx`の一番外側の`<div>`、`PhotoGrid.tsx`の各サムネイル`<div>`）に追加する
  - 色はsteam-blue（`#66c0f4`）をベースにする。具体的な数値は調整してよいが、派手すぎないこと（予算はdiffとして小さく保つ）
- **完了条件**：
  - [ ] ホバー時に両コンポーネントで浅い発光が見える
  - [ ] 既存のクリック動作・ズーム効果は壊れていない
  - [ ] JSXの構造やpropsは変更していない（classNameのみの変更）

### T12：動画サムネイルのホバープレビュー

- **対象ファイル**：`apps/web/src/components/photo/PhotoGrid.tsx`（このファイルのみ）
- **前提タスク**：なし（T11とは独立、どちらが先でもよい）
- **内容**：
  `mediaType === "VIDEO"` のサムネイル（`<video>`要素）に、マウスホバーで自動再生、離れたら停止して先頭に戻る動作を追加する。
  - `<video>`要素に`ref`を付け、親の`<div>`に`onMouseEnter`（`video.play()`）と`onMouseLeave`（`video.pause(); video.currentTime = 0;`）を追加
  - 既存の`muted`属性はそのまま（無音を維持）。`loop`属性も追加してループ再生させる
  - **注意**：現在この`<div>`には既に`onClick`（ライトボックスを開く）が付いている。この`onClick`は**削除せず残す**こと（ホバープレビューは追加機能、クリックでの拡大表示は引き続き動く必要がある）
  - `useRef`を使う場合、複数の動画ごとにrefが必要なので、`useRef<HTMLVideoElement>(null)`の配列や`Map`ではなく、各`<video>`要素の`onMouseEnter`ハンドラ側で`e.currentTarget`を使って直接操作する方法を推奨（refの配列管理より単純でバグりにくい）:
    ```tsx
    <video
      onMouseEnter={(e) => e.currentTarget.play()}
      onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
      ...
    />
    ```
- **完了条件**：
  - [ ] 動画サムネイルにマウスを乗せると自動再生される
  - [ ] マウスを外すと停止して先頭フレームに戻る
  - [ ] 音声は出ない（muted維持）
  - [ ] サムネイルクリックでライトボックスが引き続き開く（既存のクリック動作を壊していない）
  - [ ] 画像（IMAGE）のサムネイルには影響なし

### T13：ライトボックスのメタ情報パネル（表示のみ、編集不可）

- **対象ファイル**：`apps/web/src/components/photo/Lightbox.tsx`（props追加）、`apps/web/src/components/photo/PhotoGrid.tsx`（渡すデータ追加）、`apps/web/src/app/(main)/albums/[albumId]/page.tsx`（`PhotoGrid`に渡すpropsにメタ情報を追加）
- **前提タスク**：T8（Lightbox統合、完了済み）
- **スコープの限定**（重要）：
  - **解像度は表示しない**（DBに保存されていないため）。表示するのは、既存の`Photo`モデルにある情報のみ：撮影日（`capturedAt`）、ゲーム名（`gameTitle`）、投稿者名（`uploader.name`）、アルバム名
  - **編集機能は今回のスコープ外**。表示のみでよい
  - **対象ページはアルバム詳細ページのみ**。検索ページ（`search/page.tsx`）やホームの最近の投稿は今回は対象外（別タスクとする）
- **内容**：
  1. `Lightbox.tsx`の`LightboxProps`に任意の`meta?: { capturedAt?: string | null; gameTitle?: string | null; uploaderName?: string | null; albumTitle?: string | null }` を追加
  2. `meta`が渡された場合のみ、情報（`i`アイコン等）ボタンを右上に表示し、クリックでサイドパネルの開閉をトグル（`useState`で管理）
  3. `apps/web/src/app/(main)/albums/[albumId]/page.tsx`で、`PhotoGrid`に渡す`photos`配列の各要素に`capturedAt`/`gameTitle`を含める（このページは既に`db.photo.findMany`で全フィールド取得しているはずなので、属性を追加で渡すだけでよい）。投稿者名・アルバム名は同ページで既に取得しているalbum/ownerの情報から補う
  4. `PhotoGrid`自体の`Media`型に`capturedAt`/`gameTitle`を（どちらもオプショナルとして）追加し、`Lightbox`に渡す`meta`を組み立てる
- **完了条件**：
  - [ ] アルバム詳細ページでライトボックスを開くと、情報ボタンがある
  - [ ] ボタンを押すと撮影日・ゲーム名・投稿者名・アルバム名が正しく表示される
  - [ ] 情報がない項目（例: gameTitle未設定）は「-」などで自然に表示される（エラーにならない）
  - [ ] 既存のPrev/Next/Close機能は引き続き動く
  - [ ] 検索ページ・ホーム画面（`RecentActivity`）はこのタスクでは変更しない

---

## 保留中（Phase 2の実運用フィードバック後に判断）

- `docs/ideas.md`の「③インタラクティブなドラッグ＆ドロップUI」（未分類→アルバムへのD&D整理）
- ライトボックスメタ情報パネルの**編集機能**（T13は表示のみ）
- 検索ページ・ホーム画面へのメタ情報パネル拡張

## ステータス一覧（Phase 2分、Claudeがレビュー後に更新する）

| タスク ID | 前提タスク | ステータス |
|---|---|---|
| T11 | なし | 完了（Claudeが直接実装） |
| T12 | なし | 完了（Claudeが直接実装） |
| T13 | T8（完了済み） | 完了（Claudeが直接実装） |
