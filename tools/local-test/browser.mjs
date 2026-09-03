// B: 実ブラウザで主要ページを開き、ページ例外・ハイドレーションエラーを拾う。
import { encode } from "next-auth/jwt";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);
const EXECUTABLE = process.env.CHROMIUM_PATH;

// **playwright-core が無いときに「スキップして exit 0」してはいけない。**
// 以前はそうしていた（依存に入れていなかったため）が、そのせいで run-all.mjs 経由だと
// **1件も流していないのに OK と出る**。CI に載せる以上、いちばん避けたいのがこれなので
// 落とす。いまは root の devDependencies に入っているので、ここに来る＝インストールが
// 壊れている。
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch (e) {
  console.error("playwright-core を読み込めませんでした。`pnpm install` を実行してください。");
  console.error(e.message);
  process.exit(1);
}

// アプリの不具合ではないと分かっている失敗は無視する。
//   - Google Fonts: サンドボックスから外へ出られないので必ず失敗する
//   - _next/image で模擬R2（127.0.0.1:9100）を指すもの: next.config.js の remotePatterns は
//     httpのlocalhostを許可していないため必ず400になる。本番のR2は https の pub-*.r2.dev で
//     許可済みなので、**これはローカル環境の都合であってアプリの問題ではない**。
//     そのぶん「画像が実際に表示されるか」はローカルでは確認できない（README参照）。
//   - 「Failed to fetch RSC payload ... Falling back to browser navigation」:
//     先読みが中断されたときに出る。このハーネスはページを次々に開いて閉じるので、
//     飛ばした先読みが途中で切れる。Next.js側は通常のページ遷移に切り替えて処理を続けるため
//     ユーザーには影響しない（実際に出たり出なかったりで、再実行すると消えた）。
const IGNORED = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /_next\/image\?url=http%3A%2F%2F127\.0\.0\.1%3A9100/,
  /Failed to fetch RSC payload/,
];

const targets = [
  ["B01", "ホーム", "/"],
  ["B02", "アルバム一覧", "/albums"],
  ["B03", "アルバム詳細", `/albums/${ids.albumId}`],
  ["B04", "未分類の投稿", "/albums/unclassified"],
  ["B05", "グループ一覧", "/groups"],
  ["B06", "グループ詳細", `/groups/${ids.groupId}`],
  ["B07", "ゲーム詳細", `/groups/${ids.groupId}/games/${ids.gameId}`],
  ["B08", "提案詳細", `/groups/${ids.groupId}/proposals/${ids.proposalId}`],
  ["B09", "アップロード", "/upload"],
  ["B10", "検索", "/search"],
  ["B11", "マニュアル", "/manual"],
  ["B12", "設定・プロフィール", "/settings/profile"],
  ["B13", "設定・許可リスト", "/settings/allowlist"],
  ["B14", "設定・Discord連携", "/settings/discord"],
  ["B15", "管理・使用量", "/admin"],
  ["B16", "管理・ユーザー", "/admin/users"],
  ["B17", "管理・招待リンク", "/admin/invites"],
  ["B18", "管理・メディア一覧", "/admin/media"],
  ["B19", "管理・エラー", "/admin/errors"],
  ["B19b", "管理・活動カレンダー", "/admin/activity"],
];

// `--no-sandbox` を付けている。開くのは自分のローカルサーバーだけで外部のページは
// 一切踏まないため、サンドボックスで守る対象が無い。逆に付けないと環境側の都合で
// 起動できないことがある（rootで動くコンテナ、Ubuntu 24.04 の
// apparmor による unprivileged userns の制限など）。**確認したいのはアプリの挙動**なので、
// 環境ごとに起動可否が変わる要因は消しておく。
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addCookies([
  {
    name: "next-auth.session-token",
    value: await encode({
      token: { name: "admin", email: "admin@example.com", sub: "admin@example.com" },
      secret: SECRET,
      maxAge: 3600,
    }),
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
  },
]);

const rows = [];
for (const [id, label, path] of targets) {
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`例外: ${e.message}`.slice(0, 140)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    if (text.includes("Failed to load resource") && IGNORED.some((re) => re.test(m.location()?.url ?? ""))) return;
    problems.push(text.slice(0, 140));
  });

  const res = await page
    .goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 })
    .catch((e) => (problems.push(`遷移失敗: ${e.message}`.slice(0, 120)), null));

  // 遅れて出るエラー（ハイドレーション後の例外など）も拾えるよう、判定の前に少し待つ
  await page.waitForTimeout(500);

  rows.push({
    id,
    item: `ブラウザで開いて例外が出ない: ${label}`,
    expected: "200 / 例外なし",
    actual: `${res?.status() ?? "—"} / ${problems.length}件`,
    ok: res?.status() === 200 && problems.length === 0,
    note: problems.join(" | ").slice(0, 200),
  });
  await page.close();
}

// ── ゲーム一覧のフィルタ初期状態 ──
// サーバーは全件を描画し、絞り込みはハイドレーション後にクライアントで効く。
// curlでは確認できないのでここで見る。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const visible = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/games/"]')].map((a) => a.textContent ?? "")
  );
  const text = visible.join(" ");

  const pressed = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent?.trim())
  );

  rows.push({
    id: "B20",
    item: "ゲーム一覧の初期フィルタが「プレイ中」「気になる」だけ",
    expected: "プレイ中・気になるが選択済み",
    actual: pressed.join(",") || "なし",
    ok: pressed.includes("プレイ中") && pressed.includes("気になる") && !pressed.includes("積みゲー"),
    note: "",
  });

  rows.push({
    id: "B21",
    item: "初期状態で積みゲー・クリア済みは出ない",
    expected: "出ない",
    actual: text.includes("積みゲー") || text.includes("クリア済み") ? "出ている" : "出ていない",
    ok: !text.includes("積みゲー") && !text.includes("クリア済み") && text.includes("ウィッチャー3"),
    note: text.slice(0, 120),
  });

  // 「すべて」を押せば戻せること
  await page.getByRole("button", { name: "すべて" }).click();
  await page.waitForTimeout(300);
  const afterAll = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/games/"]')].map((a) => a.textContent ?? "").join(" ")
  );
  rows.push({
    id: "B22",
    item: "「すべて」を押すと積みゲー・クリア済みも出る",
    expected: "出る",
    actual: afterAll.includes("積みゲー") ? "出た" : "出ない",
    ok: afterAll.includes("積みゲー") && afterAll.includes("クリア済み"),
    note: afterAll.slice(0, 120),
  });

  await page.close();
}

// ── 絞り込みの保存（localStorage） ──
{
  const page = await context.newPage();
  const url = `${BASE}/groups/${ids.groupId}`;
  const hydrationErrors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/hydrat|did not match|Text content does not match/i.test(t)) hydrationErrors.push(t.slice(0, 140));
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 「すべて」を押して既定と違う状態にする
  await page.getByRole("button", { name: "すべて" }).click();
  await page.waitForTimeout(400);

  const stored = await page.evaluate((gid) => localStorage.getItem(`gh:game-filter:v1:${gid}`), ids.groupId);
  rows.push({
    id: "B23",
    item: "絞り込みがグループ単位のキーで保存される",
    expected: "保存される",
    actual: stored ?? "なし",
    ok: !!stored && JSON.parse(stored).status.length === 0,
    note: "",
  });

  // リロードしても「すべて」のまま（既定に戻らない）
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/games/"]')].map((a) => a.textContent ?? "").join(" ")
  );
  rows.push({
    id: "B24",
    item: "リロードしても前回の絞り込みが復元される",
    expected: "積みゲーも出る",
    actual: afterReload.includes("積みゲー") ? "出た" : "既定に戻った",
    ok: afterReload.includes("積みゲー") && afterReload.includes("クリア済み"),
    note: "",
  });

  // 保存を消せば既定に戻る
  await page.evaluate((gid) => localStorage.removeItem(`gh:game-filter:v1:${gid}`), ids.groupId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const afterClear = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/games/"]')].map((a) => a.textContent ?? "").join(" ")
  );
  rows.push({
    id: "B25",
    item: "保存を消すと既定（プレイ中・気になる）に戻る",
    expected: "積みゲーは出ない",
    actual: afterClear.includes("積みゲー") ? "出ている" : "出ていない",
    ok: !afterClear.includes("積みゲー") && afterClear.includes("ウィッチャー3"),
    note: "",
  });

  rows.push({
    id: "B26",
    item: "復元でハイドレーションのずれが出ない",
    expected: "0件",
    actual: `${hydrationErrors.length}件`,
    ok: hydrationErrors.length === 0,
    note: hydrationErrors.join(" | ").slice(0, 160),
  });

  await page.close();
}

// ── アルバムの並び替え ──
// サーバーは「更新が新しい順」で渡すだけで、並び替えはハイドレーション後に
// クライアントで効く。curlでは確認できないのでここで見る。
// seed.mjs が4つの並び順すべてで違う結果になるようデータを仕込んである。
//
// **他のスイートが同じグループにアルバムを足す**（flowsがDiscordタグ経由で
// "eldenring" を作る）ので、**位置で判定してはいけない**。最初これで書いたら
// run-all 経由のときだけ落ちた。seedで仕込んだ3件の**相対順序**だけを見る。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 既定では4件までしか出ないので、全部出してから並びを見る
  async function expandAll() {
    for (let i = 0; i < 10; i++) {
      const more = page.getByRole("button", { name: /さらに表示/ });
      if ((await more.count()) === 0) break;
      await more.first().click();
      await page.waitForTimeout(150);
    }
  }

  const SEEDED = ["エルデンリング", "ゼルダの伝説", "あつまれ どうぶつの森"];

  // 表示順のタイトル一覧。seedで仕込んだ3件だけに絞る
  async function seededOrder() {
    await expandAll();
    const all = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/albums/"]')]
        .map((a) => a.querySelector("p.font-display")?.textContent?.trim() ?? "")
        .filter(Boolean)
    );
    return all.filter((t) => SEEDED.includes(t));
  }

  const pressedSort = () =>
    page.evaluate(() => {
      const labels = ["更新順", "新着順", "名前順", "写真の多い順"];
      return [...document.querySelectorAll('button[aria-pressed="true"]')]
        .map((b) => b.textContent?.trim() ?? "")
        .filter((t) => labels.includes(t));
    });

  const initial = await seededOrder();
  rows.push({
    id: "B27",
    item: "アルバムの初期の並びは更新順",
    expected: "エルデンリング → ゼルダの伝説 → あつまれ どうぶつの森",
    actual: initial.join(" → "),
    ok: initial.join("|") === "エルデンリング|ゼルダの伝説|あつまれ どうぶつの森",
    note: "",
  });

  const pressed = await pressedSort();
  rows.push({
    id: "B28",
    item: "「更新順」が選択済みとして表示される",
    expected: "更新順",
    actual: pressed.join(",") || "なし",
    ok: pressed.includes("更新順"),
    note: "",
  });

  // **新着順は更新順と別の並びになること。** ここが同じだと、createdAt を渡し忘れて
  // updatedAt で並べていても気づけない（seed が別の順序になるよう仕込んである）
  await page.getByRole("button", { name: "新着順" }).click();
  await page.waitForTimeout(300);
  const byCreated = await seededOrder();
  rows.push({
    id: "B29",
    item: "「新着順」は作成日時で並ぶ（更新順とは別の並び）",
    expected: "ゼルダの伝説 → あつまれ どうぶつの森 → エルデンリング",
    actual: byCreated.join(" → "),
    ok: byCreated.join("|") === "ゼルダの伝説|あつまれ どうぶつの森|エルデンリング",
    note: "",
  });

  await page.getByRole("button", { name: "名前順" }).click();
  await page.waitForTimeout(300);
  const byTitle = await seededOrder();
  rows.push({
    id: "B30",
    item: "「名前順」は日本語の読みで並ぶ（あ→エ→ゼ）",
    expected: "あつまれ どうぶつの森 → エルデンリング → ゼルダの伝説",
    actual: byTitle.join(" → "),
    ok: byTitle.join("|") === "あつまれ どうぶつの森|エルデンリング|ゼルダの伝説",
    note: "",
  });

  await page.getByRole("button", { name: "写真の多い順" }).click();
  await page.waitForTimeout(300);
  await expandAll();
  // 枚数バッジは数字だけで、**0枚のアルバムには描画されない**ので、無い＝0とみなす
  const counts = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/albums/"]')].map((a) =>
      Number(a.querySelector("div.absolute")?.textContent?.trim() ?? "0")
    )
  );
  rows.push({
    id: "B31",
    item: "「写真の多い順」は枚数が減る順に並ぶ",
    expected: "降順",
    actual: counts.join(" → "),
    ok: counts.length > 1 && counts.every((n, i) => i === 0 || counts[i - 1] >= n),
    note: "",
  });

  // 枚数は他のスイートの写真追加・削除で動くが、**ゼルダ(3枚)があつまれ(0枚)より
  // 前に来る**ことは常に成り立つ（あつまれはどこからも触られない）
  const byPhotos = await seededOrder();
  rows.push({
    id: "B31b",
    item: "「写真の多い順」で0枚のアルバムが3枚のアルバムより後ろに来る",
    expected: "ゼルダの伝説 が あつまれ どうぶつの森 より前",
    actual: byPhotos.join(" → "),
    ok: byPhotos.indexOf("ゼルダの伝説") < byPhotos.indexOf("あつまれ どうぶつの森"),
    note: "",
  });

  // 更新順に戻せること（既定へ復帰できないと、他の並びに固定されて見える）
  await page.getByRole("button", { name: "更新順" }).click();
  await page.waitForTimeout(300);
  const backToUpdated = await seededOrder();
  rows.push({
    id: "B32",
    item: "「更新順」に戻せる",
    expected: initial.join(" → "),
    actual: backToUpdated.join(" → "),
    ok: backToUpdated.join("|") === initial.join("|"),
    note: "",
  });

  await page.close();
}

// ── 写真へのリアクション（❤️） ──
// 押した瞬間の表示更新も、Lightboxを開いたときのボタンも、クライアント側でしか動かない。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // グリッド上の❤️（サムネイルの左上）。押す前は0件なので数字は出ない
  const gridHearts = page.locator('[aria-label="リアクションする"], [aria-label="リアクションを取り消す"]');

  // **この節は「まだ誰も押していない」状態から始まらないと成立しない**（B34 は押した数を
  // 1と断定する）。以前は押したままで終わっていたため、**同じDBに2回流すと落ちた**
  // （2回目の1押し目が「取り消す」になる）。CIは毎回まっさらなDBなのでCIでは出ない壊れ方。
  // 始める前に全部外し、終わったらまた外して、何度流しても同じ結果になるようにする。
  const clearAllHearts = async () => {
    const pressedBtns = page.locator('[aria-label="リアクションを取り消す"]');
    // 上限を切っているのは、外せない状態に陥ったときに無限に回さないため
    for (let i = 0; i < 10 && (await pressedBtns.count()) > 0; i++) {
      await pressedBtns.first().click();
      await page.waitForTimeout(500);
    }
  };
  await clearAllHearts();

  const heartCount = await gridHearts.count();
  rows.push({
    id: "B33",
    item: "グリッドの各写真に❤️ボタンが出る",
    expected: "1つ以上",
    actual: `${heartCount}個`,
    ok: heartCount > 0,
    note: "",
  });

  // 押すとその場で数が増える（往復を待たずに変わること）
  await gridHearts.first().click();
  await page.waitForTimeout(600);
  const pressed = await page.evaluate(
    () => document.querySelectorAll('[aria-label="リアクションを取り消す"]').length
  );
  const firstText = (await gridHearts.first().textContent())?.trim() ?? "";
  rows.push({
    id: "B34",
    item: "❤️を押すと押した状態になり件数が出る",
    expected: "押した状態 / 1",
    actual: `押した状態=${pressed} / 表示=${firstText}`,
    ok: pressed === 1 && firstText.includes("1"),
    note: "",
  });

  // もう一度押すと取り消せる
  await gridHearts.first().click();
  await page.waitForTimeout(600);
  const afterUndo = await page.evaluate(
    () => document.querySelectorAll('[aria-label="リアクションを取り消す"]').length
  );
  rows.push({
    id: "B35",
    item: "もう一度押すと取り消せる",
    expected: "0",
    actual: `${afterUndo}`,
    ok: afterUndo === 0,
    note: "",
  });

  // Lightbox を開くと大きい❤️と、押した人の名前が出る。
  // **Lightboxの中だけを見ること。** 背後のグリッドはDOMに残ったままなので、
  // document 全体を数えるとグリッドのボタンまで混ざる（最初これで判定を誤った）。
  const LIGHTBOX = "div.fixed.inset-0.z-50";
  await gridHearts.first().click();
  await page.waitForTimeout(600);
  await page.locator("div.aspect-square").first().click();
  await page.waitForTimeout(700);

  const inLightbox = await page.locator(`${LIGHTBOX} [aria-label="リアクションを取り消す"]`).count();
  const lightboxText = (await page.locator(LIGHTBOX).first().textContent()) ?? "";
  // 名前は seed の表示名（ログイン用のメールではなく User.name）。
  // ここを "admin" で書いて落とした——押した本人の表示名が出る仕様なので "管理者ユーザー"
  const REACTOR = "管理者ユーザー";
  rows.push({
    id: "B36",
    item: "Lightboxに❤️と押した人の名前が出る",
    expected: `ボタンあり / ${REACTOR}`,
    actual: `ボタン=${inLightbox}個 / 名前=${lightboxText.includes(REACTOR)}`,
    ok: inLightbox > 0 && lightboxText.includes(REACTOR),
    note: lightboxText.replace(/\s+/g, " ").slice(0, 120),
  });

  // **前へ/次へで写真を切り替えたとき、前の写真の❤️の状態が残らないこと。**
  // PhotoReactionButton に key を付けていないとここが壊れる（切り替えた後だけ壊れる）
  const next = page.getByRole("button", { name: "次の写真" });
  if ((await next.count()) > 0 && (await next.first().isEnabled())) {
    await next.first().click();
    await page.waitForTimeout(600);
    const stillPressed = await page
      .locator(`${LIGHTBOX} [aria-label="リアクションを取り消す"]`)
      .count();
    rows.push({
      id: "B37",
      item: "次の写真へ移ると❤️の状態が引き継がれない",
      expected: "0（この写真にはまだ付いていない）",
      actual: `${stillPressed}`,
      ok: stillPressed === 0,
      note: "",
    });
  }

  // 押した❤️を外して、始める前の状態に戻す（上の clearAllHearts のコメント参照）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await clearAllHearts();

  await page.close();
}

// ── 写真の説明 ──
// 表示・編集・グリッドの印はすべてクライアント側なのでここでしか見えない。
// **seedのデータには依存しない**（flowsが説明を書いて消すので、通しで流すと状態が変わる）。
// 自分で書いてから確認する形にしてある。
{
  const page = await context.newPage();
  const LIGHTBOX = "div.fixed.inset-0.z-50";

  // **この節は「説明が無い」状態から始まらないと成立しない**（B38）。
  // 以前は自分で書いた説明を消さずに終わっていたため、**同じDBに対して2回流すと落ちた**
  // （2回目は「説明を書く」ではなく「編集」になり、locatorが見つからずタイムアウトする）。
  // CIは毎回まっさらなDBなので、この壊れ方はCIでは絶対に出ない。
  // 始める前に消し、終わったらまた消して、何度流しても同じ結果になるようにする。
  // 空文字で保存すると説明は削除される（PhotoDescription.tsx の placeholder のとおり）。
  const clearDescription = async () => {
    const edit = page.locator(`${LIGHTBOX} [aria-label="説明を編集"]`);
    if ((await edit.count()) === 0) return;
    await edit.first().click();
    await page.waitForTimeout(300);
    await page.locator(`${LIGHTBOX} textarea`).fill("");
    await page.locator(`${LIGHTBOX} [aria-label="説明を保存"]`).click();
    await page.waitForTimeout(900);
  };

  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.locator("div.aspect-square").first().click();
  await page.waitForTimeout(700);
  await clearDescription();

  const emptyText = (await page.locator(LIGHTBOX).first().textContent()) ?? "";
  rows.push({
    id: "B38",
    item: "説明が無い写真は「まだありません」と出て、書くボタンがある",
    expected: "両方あり",
    actual: `文言=${emptyText.includes("説明はまだありません")} / ボタン=${await page
      .locator(`${LIGHTBOX} [aria-label="説明を書く"]`)
      .count()}`,
    ok:
      emptyText.includes("説明はまだありません") &&
      (await page.locator(`${LIGHTBOX} [aria-label="説明を書く"]`).count()) > 0,
    note: "",
  });

  const TEXT = "夜のリムグレイブ。月が写り込んでいる";
  await page.locator(`${LIGHTBOX} [aria-label="説明を書く"]`).first().click();
  await page.waitForTimeout(300);
  await page.locator(`${LIGHTBOX} textarea`).fill(TEXT);
  await page.locator(`${LIGHTBOX} [aria-label="説明を保存"]`).click();
  await page.waitForTimeout(900);

  const savedText = (await page.locator(LIGHTBOX).first().textContent()) ?? "";
  rows.push({
    id: "B39",
    item: "説明を書いて保存すると、本文と書き手が出る",
    expected: `本文 / 管理者ユーザー`,
    actual: `本文=${savedText.includes(TEXT)} / 書き手=${savedText.includes("管理者ユーザー")}`,
    ok: savedText.includes(TEXT) && savedText.includes("管理者ユーザー"),
    note: savedText.replace(/\s+/g, " ").slice(0, 120),
  });

  // Lightboxを閉じるとグリッドに「説明あり」の印が出る（再読み込みなしで反映されること）
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  rows.push({
    id: "B40",
    item: "説明を書くとグリッドに印が出る（再読み込み不要）",
    expected: "1つ以上",
    actual: `${await page.locator('[aria-label="説明あり"]').count()}個`,
    ok: (await page.locator('[aria-label="説明あり"]').count()) > 0,
    note: "",
  });

  // **書き換えたらキャッシュが飛んでいること。**
  // 飛ばし忘れると、再読み込みしたときに書いたはずの説明が消えて見える。
  //
  // 判定は**書いた本文そのもの**で見る。「印が1つ以上あるか」だと、
  // 別の写真に残っている説明で通ってしまい、無効化を外しても落ちなかった（実際に踏んだ）。
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("div.aspect-square").first().click();
  await page.waitForTimeout(700);
  const afterReload = (await page.locator(LIGHTBOX).first().textContent()) ?? "";
  rows.push({
    id: "B41",
    item: "再読み込みしても書いた説明が残る（キャッシュが飛んでいる）",
    expected: "本文あり",
    actual: afterReload.includes(TEXT) ? "残っている" : "消えている",
    ok: afterReload.includes(TEXT),
    note: afterReload.replace(/\s+/g, " ").slice(0, 120),
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // **前へ/次へで説明が引き継がれないこと。** ❤️と同じくkeyが要る箇所
  await page.locator("div.aspect-square").first().click();
  await page.waitForTimeout(700);
  const next = page.getByRole("button", { name: "次の写真" });
  if ((await next.count()) > 0 && (await next.first().isEnabled())) {
    await next.first().click();
    await page.waitForTimeout(600);
    const nextText = (await page.locator(LIGHTBOX).first().textContent()) ?? "";
    rows.push({
      id: "B42",
      item: "次の写真へ移ると前の写真の説明が残らない",
      expected: "残らない",
      actual: nextText.includes(TEXT) ? "残っている" : "残っていない",
      ok: !nextText.includes(TEXT),
      note: "",
    });
  }

  // 書いた説明を消して、始める前の状態に戻す（上の clearDescription のコメント参照）
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator("div.aspect-square").first().click();
  await page.waitForTimeout(700);
  await clearDescription();

  await page.close();
}

// ── 未分類の振り分け：グループ→アルバムの2段階 ──
// **別グループの同名アルバムを取り違える**という報告への対応。
// 「グループを選ぶまでアルバムを選べない」「選んだグループのアルバムだけが出る」を、
// 実際に2つのグループを持つ状態を作って確かめる（seedのadminは1グループなので、
// **1つだけだと自動選択されてしまい、この経路を通らない**）。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/albums/unclassified`, { waitUntil: "networkidle" });

  /** ブラウザのセッションでAPIを叩く（テスト用のデータを作る／片付ける） */
  const callApi = (path, method, body) =>
    page.evaluate(
      async ([p, m, b]) => {
        const res = await fetch(p, {
          method: m,
          headers: b ? { "content-type": "application/json" } : {},
          body: b ? JSON.stringify(b) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => null) };
      },
      [path, method, body ?? null]
    );

  const SAME_TITLE = "取り違え確認用アルバム";
  const created = await callApi("/api/groups", "POST", { name: "取り違え確認用グループ" });
  const groupB = created.json?.group?.id ?? null;
  const albumA = (await callApi("/api/albums", "POST", { title: SAME_TITLE, groupId: ids.groupId }))
    .json?.album?.id;
  const albumB = groupB
    ? (await callApi("/api/albums", "POST", { title: SAME_TITLE, groupId: groupB })).json?.album?.id
    : null;

  if (groupB && albumA && albumB) {
    await page.goto(`${BASE}/albums/unclassified`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const groupSelect = page.locator("select").first();
    const albumSelect = page.locator("select").nth(1);

    // グループが2つになったので自動選択されない＝アルバムは選べない状態から始まる
    rows.push({
      id: "B45",
      item: "グループを選ぶまでアルバムを選べない",
      expected: "無効",
      actual: (await albumSelect.isDisabled()) ? "無効" : "有効",
      ok: await albumSelect.isDisabled(),
      note: "",
    });

    /** アルバムのプルダウンに出ている選択肢（先頭の案内は除く） */
    const albumOptions = () =>
      albumSelect.evaluate((el) =>
        [...el.querySelectorAll("option")].slice(1).map((o) => o.value)
      );

    await groupSelect.selectOption(ids.groupId);
    await page.waitForTimeout(200);
    const inA = await albumOptions();

    await groupSelect.selectOption(groupB);
    await page.waitForTimeout(200);
    const inB = await albumOptions();

    // **同名のアルバムが両方のグループにある状態で、混ざらないこと**が本題
    rows.push({
      id: "B46",
      item: "選んだグループのアルバムだけが出る（同名でも混ざらない）",
      expected: "Aには片方だけ / Bには片方だけ",
      actual: `A=${inA.includes(albumA) && !inA.includes(albumB)} B=${inB.includes(albumB) && !inB.includes(albumA)}`,
      ok:
        inA.includes(albumA) && !inA.includes(albumB) && inB.includes(albumB) && !inB.includes(albumA),
      note: "",
    });

    // グループを切り替えたら、前のグループのアルバムが選ばれたまま残らないこと
    rows.push({
      id: "B47",
      item: "グループを切り替えるとアルバムの選択が外れる",
      expected: "未選択",
      actual: (await albumSelect.inputValue()) || "未選択",
      ok: (await albumSelect.inputValue()) === "",
      note: "",
    });

    // 新しいグループを作る導線が出ていること（グループが無い人の逃げ道）
    const newGroupLink = page.locator('a[href="/groups/new"]');
    rows.push({
      id: "B48",
      item: "新しいグループを作るリンクが出ている",
      expected: "1件以上",
      actual: String(await newGroupLink.count()),
      ok: (await newGroupLink.count()) > 0,
      note: "",
    });
  } else {
    rows.push({
      id: "B45",
      item: "グループを選ぶまでアルバムを選べない",
      expected: "準備できる",
      actual: "テスト用のグループ／アルバムを作れなかった",
      ok: false,
      note: `group=${groupB} albumA=${albumA} albumB=${albumB}`,
    });
  }

  // 後片付け（API経由。DB直で消すとキャッシュに残る。lessons.md）
  if (albumA) await callApi(`/api/albums/${albumA}`, "DELETE");
  if (albumB) await callApi(`/api/albums/${albumB}`, "DELETE");
  if (groupB) await callApi(`/api/groups/${groupB}`, "DELETE");

  await page.close();
}

// ── マニュアルの節が開けること ──
// 権限の節には表を入れてある。アコーディオンを開くまで描画されないので、
// 開いた状態を実際に見る（描画で落ちると、閉じている限り気づけない）。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/manual`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /権限（オーナー／編集者／閲覧者）/ }).click();
  await page.waitForTimeout(200);
  const permissionText = (await page.locator("table").first().textContent()) ?? "";
  rows.push({
    id: "B49",
    item: "マニュアルの権限の節に表が出る",
    expected: "できること／必要な権限の行がある",
    actual: permissionText.includes("必要な権限") ? "出ている" : "出ていない",
    ok: permissionText.includes("必要な権限") && permissionText.includes("閲覧者"),
    note: "",
  });

  await page.getByRole("button", { name: /未分類の投稿を振り分ける/ }).click();
  await page.waitForTimeout(200);
  const unclassifiedShown = await page.getByText("グループを選んでから").count();
  rows.push({
    id: "B50",
    item: "マニュアルの未分類の節が開く",
    expected: "本文が出る",
    actual: unclassifiedShown > 0 ? "出ている" : "出ていない",
    ok: unclassifiedShown > 0,
    note: "",
  });

  await page.close();
}

await browser.close();
const summary = writeResults("browser", "B: 実ブラウザでの描画", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
