// B: 実ブラウザで主要ページを開き、ページ例外・ハイドレーションエラーを拾う。
// playwright-core が入っていない環境ではスキップする（このリポジトリの依存には含めていない）。
import { encode } from "next-auth/jwt";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);
const EXECUTABLE = process.env.CHROMIUM_PATH;

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("playwright-core が無いためブラウザ確認はスキップします（npm i -D playwright-core）");
  process.exit(0);
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
];

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
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

  await page.close();
}

await browser.close();
const summary = writeResults("browser", "B: 実ブラウザでの描画", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
