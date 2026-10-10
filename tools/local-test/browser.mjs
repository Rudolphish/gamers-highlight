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
  //   - YouTubeの埋め込み（youtube-nocookie.com）と i.ytimg.com:
  //     サンドボックスから外へ出られないので必ず失敗する。**アプリ側は
  //     iframeのsrcを組み立てるだけ**なので、ここで確認できるのはURLが正しいことまで。
  //     実際に再生できるかは本番でしか見られない（README参照）。
  /youtube-nocookie\.com/,
  /i\.ytimg\.com/,
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

// ── アルバム名の変更（鉛筆アイコン） ──
// **入口の出し分けまで見る。** サーバー側の権限（F153）は別に確認しているが、
// 「権限が無い人に入口を出さない」はページ側の判断なので、実際に描かせないと分からない。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });

  const pencil = page.getByRole("button", { name: "アルバム名を変更" });
  rows.push({
    id: "B51",
    item: "アルバムのオーナーには名前の変更ボタンが出る",
    expected: "出る",
    actual: (await pencil.count()) > 0 ? "出ている" : "出ていない",
    ok: (await pencil.count()) > 0,
    note: "",
  });

  // 実際に書き換えて、見出しが変わるところまで。**元の名前に戻してから終わる**
  // （このスイートを2回流すと2回目が別の状態から始まるため。lessons.md）
  const original = "エルデンリング";
  const renamed = `${original}（改名テスト）`;
  let heading = "";
  if ((await pencil.count()) > 0) {
    await pencil.click();
    const input = page.getByRole("textbox", { name: "アルバム名" });
    await input.fill(renamed);
    await page.getByRole("button", { name: "アルバム名を保存" }).click();
    await page.waitForTimeout(1200);
    heading = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
  }
  rows.push({
    id: "B52",
    item: "名前を書き換えると見出しが変わる",
    expected: renamed,
    actual: heading,
    ok: heading.trim() === renamed,
    note: "",
  });

  // 空のまま保存しようとしたらその場で止まる（APIまで飛ばさない）
  let emptyBlocked = false;
  if (heading.trim() === renamed) {
    await page.getByRole("button", { name: "アルバム名を変更" }).click();
    const input = page.getByRole("textbox", { name: "アルバム名" });
    await input.fill("   ");
    await page.getByRole("button", { name: "アルバム名を保存" }).click();
    await page.waitForTimeout(400);
    emptyBlocked = (await page.getByText("アルバム名を入力してください").count()) > 0;
    // 元に戻す
    await input.fill(original);
    await page.getByRole("button", { name: "アルバム名を保存" }).click();
    await page.waitForTimeout(1200);
  }
  rows.push({
    id: "B53",
    item: "空のアルバム名は保存できない",
    expected: "その場でエラーが出る",
    actual: emptyBlocked ? "出た" : "出ない",
    ok: emptyBlocked,
    note: "",
  });

  const restored = (await page.getByRole("heading", { level: 1 }).first().textContent()) ?? "";
  rows.push({
    id: "B54",
    item: "テストの後始末で元の名前に戻っている",
    expected: original,
    actual: restored.trim(),
    ok: restored.trim() === original,
    note: "",
  });

  await page.close();

  // グループの編集者でも、そのアルバムに招待されていなければ入口は出ない
  // （グループの権限が配下のアルバムに与えるのは VIEWER まで）
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await memberContext.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { name: "member", email: "member@example.com", sub: "member@example.com" },
        secret: SECRET,
        maxAge: 3600,
      }),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
    },
  ]);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(`${BASE}/albums/${ids.adminOnlyAlbumId}`, { waitUntil: "networkidle" });
  const memberPencil = await memberPage.getByRole("button", { name: "アルバム名を変更" }).count();
  const memberSeesAlbum = (await memberPage.getByRole("heading", { level: 1 }).count()) > 0;
  rows.push({
    id: "B55",
    item: "アルバムに招待されていない人には変更ボタンが出ない（閲覧はできる）",
    expected: "ボタン無し／中身は見える",
    actual: `ボタン${memberPencil}件 / 見出し${memberSeesAlbum ? "あり" : "なし"}`,
    ok: memberPencil === 0 && memberSeesAlbum,
    note: "",
  });
  await memberPage.close();
  await memberContext.close();
}

// ── YouTube動画の表示 ──
// **iframeのsrcまで見る。** ここが間違っていても画面には枠が出るだけなので、
// 目視では気づけない（サンドボックスからは再生できず、本番でしか動かないぶん余計に）。
{
  const page = await context.newPage();
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

  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
  const created = await callApi("/api/photos", "POST", {
    youtubeUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    albumId: ids.albumId,
  });
  const youtubePhotoId = created.json?.photo?.id ?? null;

  await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const badge = await page.getByText("YouTube", { exact: false }).count();
  rows.push({
    id: "B56",
    item: "YouTubeの投稿がアルバムに並び、種類が分かる印が出る",
    expected: "印が出る",
    actual: badge > 0 ? "出ている" : "出ていない",
    ok: badge > 0,
    note: "",
  });

  // タイルを開くとiframeになる（<video> ではない）
  let iframeSrc = "";
  let videoCount = -1;
  const tiles = page.locator('div[class*="aspect-square"]');
  const count = await tiles.count();
  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    if ((await tile.getByText("YouTube").count()) === 0) continue;
    await tile.click();
    await page.waitForTimeout(600);
    // **数える範囲をLightboxの中だけに絞る。** 背後のグリッドには別の投稿の
    // <video> が残っているので、document全体を数えると必ず1個以上になる（実際に踏んだ）
    const lightbox = page.locator('div[class*="fixed"][class*="inset-0"]').last();
    iframeSrc = (await lightbox.locator("iframe").first().getAttribute("src").catch(() => "")) ?? "";
    videoCount = await lightbox.locator("video").count();
    break;
  }
  rows.push({
    id: "B57",
    item: "開くとYouTubeの埋め込み（nocookieドメイン）になる",
    expected: "https://www.youtube-nocookie.com/embed/bbbbbbbbbbb",
    actual: iframeSrc,
    ok: iframeSrc === "https://www.youtube-nocookie.com/embed/bbbbbbbbbbb",
    note: "",
  });
  rows.push({
    id: "B58",
    item: "YouTubeの投稿を<video>で再生しようとしない",
    expected: "video要素が無い",
    actual: videoCount === 0 ? "無い" : `${videoCount}個ある`,
    ok: videoCount === 0,
    note: "",
  });

  // 後片付け（API経由。DB直で消すとキャッシュに残る。lessons.md）
  if (youtubePhotoId) await callApi(`/api/photos/${youtubePhotoId}`, "DELETE");
  await page.close();
}

// ── 通知の設定（種類ごとの送り先） ──
// **プルダウンの中身と、保存が残ることまで見る。** 以前は通知先が1つで、
// 選ぶ経路（Discordのチャンネル一覧）はテストを一度も通っていなかった。
{
  const page = await context.newPage();
  await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /通知の設定/ }).click();
  await page.waitForTimeout(800);

  // 文言の正本は apps/web/src/lib/notificationTargets.ts の NOTIFICATION_KINDS。
  // ここはブラウザ側のスクリプトでTSを読めないので書き写している
  // （種類を入れ替えたときにここだけ古くなり、実際に1件落ちて気づいた）
  const labels = [
    "ゲームが提案されたとき",
    "ウィッシュリストが最安値を更新したとき",
    "週に一度のまとめ",
  ];
  const shown = [];
  for (const l of labels) shown.push(await page.getByText(l, { exact: true }).count());
  rows.push({
    id: "B59",
    item: "通知の設定に3種類が並ぶ",
    expected: "3種類とも出る",
    actual: `${shown.filter((n) => n > 0).length}/3`,
    ok: shown.every((n) => n > 0),
    note: "",
  });

  // Discordのチャンネル一覧がプルダウンに出る（取得できなければIDの直接入力に落ちる）
  const select = page.getByLabel("ゲームが提案されたとき");
  const options = await select.locator("option").allTextContents();
  rows.push({
    id: "B60",
    item: "プルダウンにDiscordのチャンネル一覧が出る（ボイスチャンネルは除く）",
    expected: "#general が出て #voice-chat は出ない",
    actual: options.join(" / "),
    ok: options.some((o) => o.includes("general")) && !options.some((o) => o.includes("voice-chat")),
    note: "",
  });

  // 選んで保存し、開き直しても残っていること
  await select.selectOption("900000000000000012");
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const counterText = (await page.getByRole("button", { name: /通知の設定/ }).textContent()) ?? "";
  await page.getByRole("button", { name: /通知の設定/ }).click();
  await page.waitForTimeout(800);
  const saved = await page.getByLabel("ゲームが提案されたとき").inputValue();
  rows.push({
    id: "B61",
    item: "選んだ通知先が保存され、再読み込みしても残る",
    expected: "900000000000000012 / 1種類がオン",
    actual: `${saved} / ${counterText.trim()}`,
    ok: saved === "900000000000000012" && counterText.includes("1/3"),
    note: "",
  });

  // 後片付け（送らないに戻す。残すと後続の実行で件数が変わる）
  await page.getByLabel("ゲームが提案されたとき").selectOption("");
  await page.waitForTimeout(1200);
  const cleared = await page.evaluate(async ([gid]) => {
    const res = await fetch(`/api/groups/${gid}`);
    return res.ok;
  }, [ids.groupId]);
  rows.push({
    id: "B62",
    item: "「送らない」に戻せる（後片付け）",
    expected: "0種類がオン",
    actual: (await page.getByRole("button", { name: /通知の設定/ }).textContent())?.trim() ?? "",
    ok: ((await page.getByRole("button", { name: /通知の設定/ }).textContent()) ?? "").includes("0/3") && cleared,
    note: "",
  });

  await page.close();
}

// ── 手動アップロードが実際に通ること ──
// **これまで /upload は「開いて例外が出ない」（B09）しか見ていなかった。**
// ファイル選択 → 署名の取得 → R2へPUT → レコード作成、という配線そのものは
// ブラウザから一度も通っていない（API単体は F が見ているが、繋がりは誰も見ていない）。
// この経路のコードをこれから共通化するので、先に落ちる状態を作れるようにしておく。
{
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`例外: ${e.message}`.slice(0, 140)));
  // 4xx/5xxを拾う。署名やPUTが失敗しても画面は「失敗しました」としか出ないので、
  // どこで落ちたかはHTTPを見ないと分からない（lessons.md）
  const bad = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !IGNORED.some((re) => re.test(r.url()))) {
      bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 80)}`);
    }
  });

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

  await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
  const before = (await callApi(`/api/albums/${ids.albumId}/photos`, "GET")).json?.photos ?? [];

  // 1x1の透過PNG。中身は何でもよいが、実際にバイト列がR2へ飛ぶことに意味がある
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator('input[type="file"]').setInputFiles([
    { name: "upload-test-1.png", mimeType: "image/png", buffer: PNG },
    { name: "upload-test-2.png", mimeType: "image/png", buffer: PNG },
  ]);
  await page.waitForTimeout(600);

  await page.getByLabel("グループ").selectOption(ids.groupId);
  await page.getByLabel("追加先アルバム").selectOption(ids.albumId);
  await page.getByRole("button", { name: /件アップロード/ }).click();

  // 完了表示が出るまで待つ（署名 → PUT → レコード作成が2ファイルぶん）
  await page.getByText("すべて完了").waitFor({ timeout: 20000 }).catch(() => {});
  const doneShown = (await page.getByText("すべて完了").count()) > 0;

  const after = (await callApi(`/api/albums/${ids.albumId}/photos`, "GET")).json?.photos ?? [];
  const added = after.filter((p) => !before.some((b) => b.id === p.id));

  // **アップロード中に出た分だけを控える。** この後で実体の有無を確かめるために
  // わざと404を踏みにいくので、それを混ぜるとB65がB64と必ず連動して落ちる
  // （2つのテストが同じことしか言わなくなる）
  const badDuringUpload = [...bad];

  rows.push({
    id: "B63",
    item: "手動アップロードでファイルが実際にアルバムへ入る",
    expected: "2枚増える",
    actual: `${added.length}枚 / 完了表示=${doneShown ? "あり" : "なし"}`,
    ok: added.length === 2 && doneShown,
    note: badDuringUpload.slice(0, 2).join(" / "),
  });

  // **保存されたURLの先に実物があること。**
  // レコードだけ作られてストレージに何も載っていないと、画面には出るのに画像が出ない
  // （404のURLを指したPhotoが残る。CLAUDE.md で「順序を逆にしてはいけない」と書いてある状態）。
  // URLの形だけ見ても、そこを取りに行かないと空振りに気づけない。
  const fetched = await page.evaluate(async (urls) => {
    const out = [];
    for (const u of urls) {
      try {
        const res = await fetch(u, { method: "GET" });
        out.push(`${res.status}:${(await res.arrayBuffer()).byteLength}`);
      } catch (e) {
        out.push(`error:${String(e).slice(0, 40)}`);
      }
    }
    return out;
  }, added.map((p) => p.mediaUrl));

  rows.push({
    id: "B64",
    item: "保存されたURLの先に実物が載っている",
    expected: "どれも 200 で中身が1バイト以上",
    actual: fetched.join(" / ") || "なし",
    ok:
      added.length > 0 &&
      added.every((p) => typeof p.mediaUrl === "string" && p.mediaUrl.includes("/gh-local/")) &&
      fetched.every((f) => f.startsWith("200:") && Number(f.split(":")[1]) > 0),
    note: "",
  });

  rows.push({
    id: "B65",
    item: "アップロード中に4xx/5xxも例外も出ない",
    expected: "無し",
    actual: [...badDuringUpload, ...problems].slice(0, 3).join(" / ") || "無し",
    ok: badDuringUpload.length === 0 && problems.length === 0,
    note: "",
  });

  // 後片付け（作ったときと同じ経路で消す）
  for (const p of added) await callApi(`/api/photos/${p.id}`, "DELETE");
  await page.close();
}

// ── アルバム詳細の「追加」モーダル ──
// **閲覧だけの人で試す。** このアルバムに投稿できる条件は「見られること」（VIEWER）で、
// member はグループの編集者だがこのアルバムには招待されていない（=VIEWER止まり）。
// アルバム名の変更は出ないが追加はできる、という組み合わせをここで踏む。
{
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await memberContext.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { name: "member", email: "member@example.com", sub: "member@example.com" },
        secret: SECRET,
        maxAge: 3600,
      }),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
    },
  ]);
  const page = await memberContext.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`例外: ${e.message}`.slice(0, 140)));
  const bad = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !IGNORED.some((re) => re.test(r.url()))) {
      bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 80)}`);
    }
  });

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

  const albumId = ids.adminOnlyAlbumId;
  await page.goto(`${BASE}/albums/${albumId}`, { waitUntil: "networkidle" });

  const tiles = () => page.locator("div.grid > div.aspect-square").count();
  const tilesBefore = await tiles();
  const before = (await callApi(`/api/albums/${albumId}/photos`, "GET")).json?.photos ?? [];

  const trigger = page.getByRole("button", { name: "写真・動画を追加" });
  const triggerCount = await trigger.count();
  rows.push({
    id: "B66",
    item: "閲覧だけの人にも「追加」が出る（投稿はVIEWERで通るため）",
    expected: "1件",
    actual: `${triggerCount}件`,
    ok: triggerCount === 1,
    note: "",
  });

  // **入口が無いときに落ちて終わらない。** ここから先は全部この入口を押す前提なので、
  // 素直に click すると locator のタイムアウトで**スイート全体が例外で止まり、
  // 70件ぶんの表がまるごと出なくなる**（壊して確認したときに実際にそうなった）。
  // どの項目が確認できていないのかが分かる形で残す。
  if (triggerCount !== 1) {
    for (const [id, item] of [
      ["B67", "モーダルから複数ファイルがこのアルバムへ入る"],
      ["B68", "再読み込みなしでグリッドに出る"],
      ["B69", "同じモーダルからYouTubeのURLも足せる"],
      ["B70", "モーダルからの追加中に4xx/5xxも例外も出ない"],
    ]) {
      rows.push({ id, item, expected: "—", actual: "未確認", ok: false, note: "「追加」が無い" });
    }
    await page.close();
    await memberContext.close();
  } else {
  await trigger.click();

  const PNG2 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator('input[type="file"]').setInputFiles([
    { name: "album-modal-1.png", mimeType: "image/png", buffer: PNG2 },
    { name: "album-modal-2.png", mimeType: "image/png", buffer: PNG2 },
  ]);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /件アップロード/ }).click();
  await page.getByText("すべて完了").waitFor({ timeout: 20000 }).catch(() => {});
  const doneShown = (await page.getByText("すべて完了").count()) > 0;

  const afterUpload = (await callApi(`/api/albums/${albumId}/photos`, "GET")).json?.photos ?? [];
  const uploaded = afterUpload.filter((p) => !before.some((b) => b.id === p.id));

  rows.push({
    id: "B67",
    item: "モーダルから複数ファイルがこのアルバムへ入る",
    expected: "2枚増える",
    actual: `${uploaded.length}枚 / 完了表示=${doneShown ? "あり" : "なし"}`,
    ok: uploaded.length === 2 && doneShown && uploaded.every((p) => p.mediaType === "IMAGE"),
    note: bad.slice(0, 2).join(" / "),
  });

  // **閉じただけで増えていること。** 無効化はAPI側で済んでいるが、開いているページは
  // 自分では取り直さない（router.refresh() が無いと、閉じても写真が出ない）
  await page.getByRole("button", { name: "閉じる" }).first().click();
  await page.waitForTimeout(1500);
  const tilesAfter = await tiles();
  rows.push({
    id: "B68",
    item: "再読み込みなしでグリッドに出る",
    expected: `${tilesBefore + 2}枚`,
    actual: `${tilesAfter}枚`,
    ok: tilesAfter === tilesBefore + 2,
    note: "",
  });

  // YouTubeは別のタブ。ファイルの経路とは完全に別で、容量も長さも見ない
  await page.getByRole("button", { name: "写真・動画を追加" }).click();
  await page.getByRole("button", { name: "YouTube", exact: true }).click();
  await page.getByLabel("YouTubeのURL").fill("https://youtu.be/ccccccccccc");
  await page.getByRole("button", { name: "この動画を追加" }).click();
  await page.getByText("追加しました").waitFor({ timeout: 15000 }).catch(() => {});

  const afterYoutube = (await callApi(`/api/albums/${albumId}/photos`, "GET")).json?.photos ?? [];
  const added = afterYoutube.filter((p) => !before.some((b) => b.id === p.id));
  const youtube = added.filter((p) => p.mediaType === "YOUTUBE");
  rows.push({
    id: "B69",
    item: "同じモーダルからYouTubeのURLも足せる",
    expected: "1件 / 正規形で保存",
    actual: `${youtube.length}件 / ${youtube[0]?.mediaUrl ?? "なし"}`,
    ok:
      youtube.length === 1 &&
      youtube[0].mediaUrl === "https://www.youtube.com/watch?v=ccccccccccc",
    note: "",
  });

  rows.push({
    id: "B70",
    item: "モーダルからの追加中に4xx/5xxも例外も出ない",
    expected: "無し",
    actual: [...bad, ...problems].slice(0, 3).join(" / ") || "無し",
    ok: bad.length === 0 && problems.length === 0,
    note: "",
  });

  // 後片付け（作ったときと同じ経路で消す。DB直で消すとキャッシュに残る）
  for (const p of added) await callApi(`/api/photos/${p.id}`, "DELETE");
  await page.close();
  await memberContext.close();
  }
}

// ── 提案の区画分けと順位 ──
// **件数が増えたときに読めること**がこの機能の目的なので、
// 「区画が人ごとに分かれる」「1区画は5件まで」「6件目は展開で出る」を画面から見る。
{
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`例外: ${e.message}`.slice(0, 140)));

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

  await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });

  // **他人の提案も自分で用意する。** seedの提案（member の GTA V）は、通しで流すと
  // flows が過半数まで投票して昇格させるのでPENDINGから外れ、区画が1つになる。
  // 他スイートが動かす値を前提にしてはいけない（docs/lessons.md）
  const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await memberCtx.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { name: "member", email: "member@example.com", sub: "member@example.com" },
        secret: SECRET,
        maxAge: 3600,
      }),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
    },
  ]);
  const memberPage = await memberCtx.newPage();
  await memberPage.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "domcontentloaded" });
  const OTHERS_TITLE = "区画テスト（他人）";
  const othersProposal = await memberPage.evaluate(
    async ([gid, title]) => {
      const res = await fetch(`/api/groups/${gid}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steamAppId: 7700100, title }),
      });
      return (await res.json().catch(() => null))?.proposal?.id ?? null;
    },
    [ids.groupId, OTHERS_TITLE]
  );

  // admin の提案を6件作る（5件の上限と「他N件」を踏むのに6件必要）。
  // **seedのゲームリストと被らないapp IDを使う**（既にリストにあるものは409で作れない）
  const titles = [
    "区画テスト1",
    "区画テスト2",
    "区画テスト3",
    "区画テスト4",
    "区画テスト5",
    "区画テスト6",
  ];
  const created = [];
  for (let i = 0; i < titles.length; i++) {
    const res = await callApi(`/api/groups/${ids.groupId}/proposals`, "POST", {
      steamAppId: 7700001 + i,
      title: titles[i],
    });
    if (res.json?.proposal?.id) created.push({ id: res.json.proposal.id, title: titles[i] });
  }

  await page.reload({ waitUntil: "networkidle" });

  /** 自分の区画に出ている順位の選択欄のラベル（＝可視カードのタイトル順） */
  const myVisibleTitles = () =>
    page.locator('select[aria-label$="の順位"]').evaluateAll((els) =>
      els.map((e) => (e.getAttribute("aria-label") ?? "").replace(/の順位$/, ""))
    );

  const sectionCount = await page.getByText(/・提案\d+件/).count();
  const mineHeading = await page.getByText(/（あなた）・提案\d+件/).count();
  rows.push({
    id: "B71",
    item: "提案が提案者ごとの区画に分かれる",
    expected: "区画2つ以上 / 自分の区画に（あなた）",
    actual: `区画${sectionCount}個 / 自分の見出し${mineHeading}個`,
    ok: created.length === 6 && !!othersProposal && sectionCount >= 2 && mineHeading === 1,
    note:
      created.length === 6 && othersProposal
        ? ""
        : `提案の用意に失敗（自分${created.length}件 / 他人=${othersProposal ? "あり" : "なし"}）`,
  });

  const visibleBefore = await myVisibleTitles();
  const moreButton = page.getByRole("button", { name: /他\d+件を表示/ });
  const hasMore = (await moreButton.count()) > 0;
  rows.push({
    id: "B72",
    item: "1区画は既定5件で、残りは「他N件を表示」に隠れる",
    expected: "5件 / ボタンあり",
    actual: `${visibleBefore.length}件 / ボタン=${hasMore ? "あり" : "なし"}`,
    ok: visibleBefore.length === 5 && hasMore,
    note: visibleBefore.join(","),
  });

  if (hasMore) await moreButton.first().click();
  await page.waitForTimeout(300);
  const visibleAfter = await myVisibleTitles();
  rows.push({
    id: "B73",
    item: "展開すると隠れていた分が出る",
    expected: "6件",
    actual: `${visibleAfter.length}件`,
    ok: visibleAfter.length === 6,
    note: "",
  });

  // **他人のカードには順位の選択欄を出さない**（上で member として作った提案で見る）
  rows.push({
    id: "B74",
    item: "他人の提案には順位の選択欄が出ない",
    expected: "含まれない",
    actual: visibleAfter.includes(OTHERS_TITLE) ? "含まれている" : "含まれない",
    ok: !visibleAfter.includes(OTHERS_TITLE),
    note: "",
  });

  // いちばん古い「区画テスト1」に1位を付けると、自分の区画の先頭に来る
  // （順位が無いうちは新しい順なので、本来は最後に近い位置にいる）
  await page.getByLabel("区画テスト1の順位").selectOption("1");
  await page.waitForTimeout(1500);
  const reordered = await myVisibleTitles();
  rows.push({
    id: "B75",
    item: "順位を付けると自分の区画の先頭に来る",
    expected: "区画テスト1",
    actual: reordered[0] ?? "（空）",
    ok: reordered[0] === "区画テスト1",
    note: reordered.join(","),
  });

  rows.push({
    id: "B76",
    item: "区画分けと順位変更で例外が出ない",
    expected: "無し",
    actual: problems.slice(0, 3).join(" / ") || "無し",
    ok: problems.length === 0,
    note: "",
  });

  // 後片付け（作ったときと同じ経路で消す）
  for (const c of created) {
    await callApi(`/api/groups/${ids.groupId}/proposals/${c.id}`, "DELETE");
  }
  if (othersProposal) {
    // 他人の提案は admin（グループのオーナー）からでも取り下げられる
    await callApi(`/api/groups/${ids.groupId}/proposals/${othersProposal}`, "DELETE");
  }
  await memberPage.close();
  await memberCtx.close();
  await page.close();
}

// ── Steam連携のモーダル（現在のゲームの表示・付け替え・解除） ──
// **アイコンだけで何をするボタンか分からなかった**のと、**間違えた連携を直せなかった**のが
// 直したかったところ。画面から「いまどのゲームと連携しているか」が読めることまで見る。
//
// **全体を try/catch で包んでいる。** この手の「クリックの連鎖」は、どこか1つの入口が
// 出ない壊れ方をすると locator が30秒待って例外になり、**スイート全体が止まって
// 結果表がまるごと消える**（docs/lessons.md）。壊して確認するたびにそれを踏んだので、
// 残りの項目を「未確認」として埋める形にした。
{
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`例外: ${e.message}`.slice(0, 140)));

  const EXPECTED = [
    ["B77", "いま連携しているゲームが名前で出る"],
    ["B78", "連携中のゲームの行にだけ印が出る"],
    ["B79", "付け替えは確認を挟む（押しただけでは変わらない）"],
    ["B80", "確認してから付け替えると連携先が変わる"],
    ["B81", "付け替えても元のゲームはリストに残る"],
    ["B82", "連携を解除すると「ゲーム詳細を見る」が消える"],
    ["B83", "連携の付け替え・解除で例外が出ない"],
  ];

  // 連携中のゲーム名は**グループのゲームリストから引く**。
  // `GET /api/albums/:id` は groupGame を含まないため（members だけ）
  const linkedTitle = () =>
    page.evaluate(
      async ([gid, aid]) => {
        const res = await fetch(`/api/groups/${gid}/games`);
        const data = await res.json().catch(() => null);
        return (data?.games ?? []).find((g) => g.albumId === aid)?.title ?? null;
      },
      [ids.groupId, ids.albumId]
    );

  try {
    // seedの「エルデンリング」アルバムは ELDEN RING（1245620）と連携済み
    await page.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Steam連携" }).click();
    await page.waitForTimeout(300);

    const currentShown = await page.getByText("現在のゲーム: ELDEN RING").count();
    rows.push({
      id: "B77",
      item: "いま連携しているゲームが名前で出る",
      expected: "1件",
      actual: `${currentShown}件`,
      ok: currentShown === 1,
      note: "",
    });

    // 連携中のゲームを検索すると、その行だけに印が出る
    await page.getByLabel("ゲーム名で検索").fill("ELDEN RING");
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await page.waitForTimeout(800);
    const badgeOnLinked = await page.getByText("これと連携中", { exact: true }).count();

    // 別のゲームを検索して付け替える。**確認を挟む**ので、押しただけでは変わらない
    await page.getByLabel("ゲーム名で検索").fill("ウィッチャー");
    await page.getByRole("button", { name: "検索", exact: true }).click();
    await page.waitForTimeout(800);

    // **連携していない行には印を出さない。** 以前は連携済みのとき全行が同じ印に変わり、
    // どのゲームと連携しているのか画面から読めなかった（「アイコンが分かりづらい」の正体）。
    // 連携中の行で1件・連携していない行で0件の**両方**を見ないと、
    // 「全行に印を出す」壊れ方を検出できない。
    // 数えるのは**バッジの文言だけ**。ボタンのラベルは「連携中」で別の文字にしてある
    // （同じ文字だと両方に当たって件数の意味が無くなる——最初これで判定を間違えた）
    const badgeOnOther = await page.getByText("これと連携中", { exact: true }).count();
    rows.push({
      id: "B78",
      item: "連携中のゲームの行にだけ印が出る",
      expected: "連携中=1件 / 他=0件",
      actual: `連携中=${badgeOnLinked}件 / 他=${badgeOnOther}件`,
      ok: badgeOnLinked === 1 && badgeOnOther === 0,
      note: "",
    });

    await page.getByRole("button", { name: /このゲームに付け替え/ }).first().click();
    await page.waitForTimeout(300);

    const confirmShown = await page
      .getByText(/「ELDEN RING」から「ウィッチャー3」に付け替えます/)
      .count();
    const linkedBeforeConfirm = await linkedTitle();
    rows.push({
      id: "B79",
      item: "付け替えは確認を挟む（押しただけでは変わらない）",
      expected: "確認あり / まだELDEN RING",
      actual: `確認${confirmShown}件 / ${linkedBeforeConfirm ?? "（連携なし）"}`,
      ok: confirmShown === 1 && linkedBeforeConfirm === "ELDEN RING",
      note: "",
    });

    // 「付け替える」で反映される
    await page.getByRole("button", { name: "付け替える" }).click();
    await page.waitForTimeout(1800);
    const afterRelink = await linkedTitle();
    rows.push({
      id: "B80",
      item: "確認してから付け替えると連携先が変わる",
      expected: "ウィッチャー3",
      actual: afterRelink ?? "（連携なし）",
      ok: afterRelink === "ウィッチャー3",
      note: "",
    });

    // 元のゲーム（ELDEN RING）はリストに残っている
    const eldenStillListed = await page.evaluate(async (gid) => {
      const res = await fetch(`/api/groups/${gid}/games`);
      const data = await res.json().catch(() => null);
      return (data?.games ?? []).some((g) => g.steamAppId === 1245620);
    }, ids.groupId);
    rows.push({
      id: "B81",
      item: "付け替えても元のゲームはリストに残る",
      expected: "残る",
      actual: eldenStillListed ? "残る" : "消えた",
      ok: eldenStillListed,
      note: "",
    });

    // 解除すると「ゲーム詳細を見る」が消える
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Steam連携" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /ゲームとの連携を解除する/ }).click();
    await page.waitForTimeout(1800);
    const detailLink = await page.getByRole("link", { name: /ゲーム詳細を見る/ }).count();
    rows.push({
      id: "B82",
      item: "連携を解除すると「ゲーム詳細を見る」が消える",
      expected: "0件",
      actual: `${detailLink}件`,
      ok: detailLink === 0,
      note: "",
    });

    rows.push({
      id: "B83",
      item: "連携の付け替え・解除で例外が出ない",
      expected: "無し",
      actual: problems.slice(0, 3).join(" / ") || "無し",
      ok: problems.length === 0,
      note: "",
    });
  } catch (e) {
    // 途中で止まったぶんは「未確認」として残す（表を消さない）
    for (const [id, item] of EXPECTED) {
      if (rows.some((r) => r.id === id)) continue;
      rows.push({
        id,
        item,
        expected: "—",
        actual: "未確認",
        ok: false,
        note: `途中で止まった: ${String(e?.message ?? e).slice(0, 80)}`,
      });
    }
  } finally {
    // 後片付け：seedの状態（ELDEN RINGと連携）に戻す。
    // **戻さないと同じDBに2回流したときの2回目が変わる**（docs/lessons.md）。
    // 壊れて途中で止まった場合も戻すので finally に置く
    await page
      .evaluate(
        async ([aid]) => {
          await fetch(`/api/albums/${aid}/game`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ steamAppId: 1245620, title: "ELDEN RING" }),
          });
        },
        [ids.albumId]
      )
      .catch(() => {});
    await page.close();
  }
}

// ───────────────────────────────────────────────────────────────
// モバイルのナビゲーションとスクロール（B84〜B96）
//
// **このスイートは最初から 390×844（スマホ相当）で走っている**ので、ここで見るのは
// ドロワー側。PC幅（1280px）は下で別の context を作って骨組みだけ見る——
// 640px以上を壊しても、390pxだけ見ていると誰も気づけない。
//
// ブロックごと try/catch で包んである。**入口ごとにガードを置くのでは足りない**
// （クリックの連鎖はどこで止まっても以降が全部消える。docs/lessons.md）
{
  const EXPECTED = [
    ["B84", "スマホ幅ではアイコンレールが出ない"],
    ["B85", "スマホ幅ではハンバーガーが出る"],
    ["B86", "ハンバーガーを押すと全項目が文字つきで出て、画面を覆う"],
    ["B87", "ドロワーのリンクで遷移し、ドロワーが閉じる"],
    ["B88", "Escで閉じる"],
    ["B89", "背景のタップで閉じる（本文には抜けない）"],
    ["B90", "開いている間は背面のスクロールが止まる"],
    ["B91", "横スクロールが出ない（スマホ幅・表のあるページ）"],
    ["B92", "本文は window がスクロールする（高さを固定したスクローラを作っていない）"],
    ["B93", "ナビの開閉で例外が出ない"],
  ];
  const recorded = new Set();
  const rec = (id, item, expected, actual, ok, note = "") => {
    recorded.add(id);
    rows.push({ id, item, expected, actual, ok, note });
  };

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

  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

    const rail = page.locator("aside");
    const railVisible = (await rail.count()) > 0 && (await rail.first().isVisible());
    rec("B84", EXPECTED[0][1], "出ていない", railVisible ? "出ている" : "出ていない", !railVisible);

    const hamburger = page.getByRole("button", { name: "メニューを開く" });
    const hamburgerVisible = (await hamburger.count()) > 0 && (await hamburger.isVisible());
    rec("B85", EXPECTED[1][1], "出ている", hamburgerVisible ? "出ている" : "出ていない", hamburgerVisible);

    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "ナビゲーション" });
    const linkTexts = await drawer.getByRole("link").allInnerTexts();
    // **高さも見る。** リンクの数と文字だけを見ていたら、ドロワーがヘッダーの帯の中
    // （高さ74px）にしか出ていない状態でも通った。`Header` の `backdrop-blur-lg` が
    // `position: fixed` の包含ブロックになるのが原因で、いまは body へポータルしている
    const drawerBox = await drawer.boundingBox();
    const viewportHeight = page.viewportSize().height;
    const coversScreen = drawerBox !== null && drawerBox.height >= viewportHeight * 0.9;
    // admin なので 管理者リンクも入って8項目（navItems.ts: 5 + 2 + 1）。
    // **文字が出ていることまで見る**——アイコンだけに戻ると、このスイートでは
    // 「リンクはある」で通ってしまう
    const labelled = linkTexts.filter((t) => t.trim().length > 0);
    rec(
      "B86",
      EXPECTED[2][1],
      "8項目すべてに文字あり / 画面の高さを覆う",
      `リンク${linkTexts.length}件 / 文字あり${labelled.length}件 / 高さ${Math.round(drawerBox?.height ?? 0)}（画面${viewportHeight}）`,
      linkTexts.length === 8 && labelled.length === 8 && coversScreen,
      labelled.join(",")
    );

    // 背面のスクロールが止まっているか（開いている今のうちに見る）
    const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    rec("B90", EXPECTED[6][1], "hidden", bodyOverflow, bodyOverflow === "hidden");

    await drawer.getByRole("link", { name: "アルバム" }).click();
    await page.waitForURL("**/albums", { timeout: 15000 });
    await page.waitForTimeout(300);
    const stillOpen = (await page.getByRole("dialog", { name: "ナビゲーション" }).count()) > 0;
    const restoredOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    rec(
      "B87",
      EXPECTED[3][1],
      "/albums へ遷移 / 閉じている / 背面のスクロールが戻る",
      `${new URL(page.url()).pathname} / ${stillOpen ? "開いている" : "閉じている"} / overflow=${restoredOverflow}`,
      new URL(page.url()).pathname === "/albums" && !stillOpen && restoredOverflow !== "hidden"
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog", { name: "ナビゲーション" }).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const afterEsc = await page.getByRole("dialog", { name: "ナビゲーション" }).count();
    rec("B88", EXPECTED[4][1], "0件", `${afterEsc}件`, afterEsc === 0);

    // **閉じ方の確認は1つずつ、状態を戻してから。** Escが効かないときに開いたままだと、
    // 次の「メニューを開く」が背景に遮られてブロックごと落ちる（壊して確認したときに踏んだ）
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("dialog", { name: "ナビゲーション" }).waitFor({ timeout: 5000 });
    // ドロワーは左端（288px）なので、右端を叩けば背景に当たる
    const urlBeforeBackdrop = new URL(page.url()).pathname;
    await page.mouse.click(370, 400);
    await page.waitForTimeout(300);
    const afterBackdrop = await page.getByRole("dialog", { name: "ナビゲーション" }).count();
    const urlAfterBackdrop = new URL(page.url()).pathname;
    // **遷移していないことまで見る。** 背景が画面を覆えていないとクリックが本文の
    // リンクに抜け、遷移のついでにドロワーが閉じるので「閉じた」だけでは通ってしまう
    rec(
      "B89",
      EXPECTED[5][1],
      "0件 / 遷移しない",
      `${afterBackdrop}件 / ${urlBeforeBackdrop === urlAfterBackdrop ? "遷移なし" : `${urlBeforeBackdrop}→${urlAfterBackdrop}`}`,
      afterBackdrop === 0 && urlBeforeBackdrop === urlAfterBackdrop
    );

    // **横スクロールが出ないこと。** `/admin/users` は中に min-w-[820px] の表がある。
    // 抑えているのは `app/(main)/layout.tsx` の内側 div（`overflow-y-auto` が
    // `overflow-x` も `auto` にする）。そこを外すとページ全体が横に流れる
    const widths = [];
    for (const path of ["/", "/admin/users"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      widths.push(
        await page.evaluate((p) => {
          const el = document.documentElement;
          return { path: p, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        }, path)
      );
    }
    const overflowing = widths.filter((w) => w.scrollWidth > w.clientWidth + 1);
    rec(
      "B91",
      EXPECTED[7][1],
      "どのページも横に溢れない",
      overflowing.length === 0
        ? "溢れなし"
        : overflowing.map((w) => `${w.path}: ${w.scrollWidth}>${w.clientWidth}`).join(" / "),
      overflowing.length === 0,
      widths.map((w) => `${w.path}=${w.scrollWidth}/${w.clientWidth}`).join(" ")
    );

    // **本文は window がスクロールする。** レイアウトの内側 div に高さ（`h-screen` など）を
    // 入れると本物のスクローラになり、`window.scrollY` が動かなくなる——スマホでURLバーが
    // 引っ込まず、縦を常時損する。`min-h` だけなら中身に合わせて伸びるので起きない
    // （この項目は `h-screen overflow-y-auto` に変えると実際に落ちることを確認済み）
    await page.goto(`${BASE}/manual`, { waitUntil: "networkidle" });
    const scrollState = await page.evaluate(async () => {
      window.scrollTo(0, 0);
      const el = document.documentElement;
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      window.scrollBy(0, 300);
      await new Promise((r) => setTimeout(r, 200));
      return { scrollable, scrollY: Math.round(window.scrollY) };
    });
    rec(
      "B92",
      EXPECTED[8][1],
      "ページが伸びていて window がスクロールする",
      `伸びている=${scrollState.scrollable} / scrollY=${scrollState.scrollY}`,
      scrollState.scrollable && scrollState.scrollY > 0
    );

    rec("B93", EXPECTED[9][1], "無し", problems.slice(0, 3).join(" / ") || "無し", problems.length === 0);
  } catch (e) {
    for (const [id, item] of EXPECTED) {
      if (recorded.has(id)) continue;
      rows.push({
        id,
        item,
        expected: "—",
        actual: "未確認",
        ok: false,
        note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}`,
      });
    }
  } finally {
    await page.close();
  }
}

// PC幅（1280px）の骨組み。**390pxだけ見ていると640px以上を壊しても気づけない。**
{
  const pcContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await pcContext.addCookies([
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
  const pcPage = await pcContext.newPage();
  try {
    await pcPage.goto(`${BASE}/`, { waitUntil: "networkidle" });

    const rail = pcPage.locator("aside");
    const railVisible = (await rail.count()) > 0 && (await rail.first().isVisible());
    rows.push({
      id: "B94",
      item: "PC幅ではアイコンレールが出ている",
      expected: "出ている",
      actual: railVisible ? "出ている" : "出ていない",
      ok: railVisible,
      note: "",
    });

    const hamburger = pcPage.getByRole("button", { name: "メニューを開く" });
    const hamburgerVisible = (await hamburger.count()) > 0 && (await hamburger.isVisible());
    rows.push({
      id: "B95",
      item: "PC幅ではハンバーガーが出ない",
      expected: "出ていない",
      actual: hamburgerVisible ? "出ている" : "出ていない",
      ok: !hamburgerVisible,
      note: "",
    });

    // **長いページでナビが流れていかないこと。** レールは `sticky top-0 h-[100dvh]` で
    // 画面に残す。これが無いと親のフレックスに引き伸ばされ、スクロールすると
    // アイコンが上に抜けていく（PCでだけ起きるので390pxだけ見ていると気づけない）
    await pcPage.goto(`${BASE}/manual`, { waitUntil: "networkidle" });
    await pcPage.evaluate(() => window.scrollTo(0, 900));
    await pcPage.waitForTimeout(300);
    // **`isVisible()` では測れない。** Playwright の可視判定はビューポート内かを見ないので、
    // 上に抜けていったリンクも「見えている」と返る（これで一度誤判定した）。
    // 画面内に居るかは bounding box の y で見る
    const navAfterScroll = pcPage.locator("aside").getByRole("link", { name: "ShareStaq ホーム" });
    const box = (await navAfterScroll.count()) > 0 ? await navAfterScroll.boundingBox() : null;
    const scrolled = await pcPage.evaluate(() => Math.round(window.scrollY));
    const viewportH = pcPage.viewportSize().height;
    const navStays = box !== null && box.y >= 0 && box.y < viewportH;
    rows.push({
      id: "B97",
      item: "PC幅で長いページをスクロールしてもナビが残る",
      expected: "画面内に居る",
      actual: box === null ? "リンクが無い" : `y=${Math.round(box.y)}（scrollY=${scrolled} / 画面高=${viewportH}）`,
      ok: navStays && scrolled > 0,
      note: "",
    });

    await pcPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const pcWidth = await pcPage.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    rows.push({
      id: "B96",
      item: "PC幅で横スクロールが出ない",
      expected: "溢れなし",
      actual: `${pcWidth.scrollWidth}/${pcWidth.clientWidth}`,
      ok: pcWidth.scrollWidth <= pcWidth.clientWidth + 1,
      note: "",
    });
  } catch (e) {
    for (const [id, item] of [
      ["B94", "PC幅ではアイコンレールが出ている"],
      ["B95", "PC幅ではハンバーガーが出ない"],
      ["B97", "PC幅で長いページをスクロールしてもナビが残る"],
      ["B96", "PC幅で横スクロールが出ない"],
    ]) {
      if (rows.some((r) => r.id === id)) continue;
      rows.push({ id, item, expected: "—", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    await pcPage.close();
    await pcContext.close();
  }
}

await browser.close();
const summary = writeResults("browser", "B: 実ブラウザでの描画", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
