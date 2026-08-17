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

await browser.close();
const summary = writeResults("browser", "B: 実ブラウザでの描画", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
