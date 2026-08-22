// リンクを辿ったときに、どの遷移でサーバーへ取りに行くかを数える。
//
// Next.jsのクライアントルーターキャッシュは、**最後に使った時刻から**
// `experimental.staleTimes.dynamic`（既定30秒）だけそのページを再利用する。
// 「行きは待つ、戻りは一瞬、しばらくして戻るとまた待つ」という挙動はこれで説明できる。
//
// 使い方: SEED_IDS=$(node tools/local-test/ids.mjs) node tools/local-test/nav-probe.mjs
import { encode } from "next-auth/jwt";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  // ここは計測用の道具なので、読めなければ何もせず終わる（合否を出すスイートではない）。
  // 合否を出す browser.mjs は逆に落とす——「流していないのにOK」を作らないため。
  console.log("playwright-core を読み込めませんでした。`pnpm install` を実行してください。");
  process.exit(0);
}

// `--no-sandbox` の理由は browser.mjs のコメント参照（開くのは自分のローカルサーバーだけ）
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext();
await context.addCookies([
  {
    name: "next-auth.session-token",
    value: await encode({
      token: {
        name: "admin",
        email: "admin@example.com",
        sub: "admin@example.com",
        userId: ids.adminId,
      },
      secret: SECRET,
      maxAge: 3600,
    }),
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
  },
]);

const page = await context.newPage();
// 先読み（next-router-prefetch: 1）と実際の取得を分けて数える。
// 先読みは動的ルートだと骨格までで本体を描画しないため、待ち時間の話とは別物。
let realFetches = [];
page.on("request", (r) => {
  const h = r.headers();
  if (!h["rsc"] && !r.url().includes("_rsc=")) return;
  if (h["next-router-prefetch"] === "1") return;
  realFetches.push(r.url().replace(BASE, "").split("?")[0]);
});

const start = Date.now();
const elapsed = () => ((Date.now() - start) / 1000).toFixed(0).padStart(3);

async function go(path, label) {
  realFetches = [];
  const link = page.locator(`a[href="${path}"]`).first();
  const t0 = Date.now();
  if (await link.count()) {
    await link.click();
  } else {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  }
  // 本文が出るまで待つ。networkidleは周辺リンクの先読みが続いて当てにならない
  await page.waitForSelector("h1", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const ms = Date.now() - t0;

  // このページ自身を取りに行ったか（先読みは除いてある）
  const fetchedSelf = realFetches.includes(path);
  console.log(
    `[${elapsed()}s] ${label.padEnd(28)} ${fetchedSelf ? "ロードあり" : "ロードなし"}  (${String(ms).padStart(4)}ms)`
  );
}

const GROUP = `/groups/${ids.groupId}`;
const ALBUM_A = `/albums/${ids.albumId}`;

// アルバムBを用意する（同じグループの2つ目）
const ALBUM_B = `/albums/${ids.albumBId}`;

await page.goto(BASE + GROUP, { waitUntil: "networkidle" });
console.log(`[  0s] グループ（最初の表示）        ロードあり`);

await go(ALBUM_A, "→ アルバムA（初回）");
await go(GROUP, "→ グループ（戻る・直後）");
await go(ALBUM_B, "→ アルバムB（初回）");
await go(GROUP, "→ グループ（戻る）");
await go(ALBUM_A, "→ アルバムA（2回目）");

console.log("\n35秒待つ（既定の30秒を超えさせる）...");
await page.waitForTimeout(35000);
await go(GROUP, "→ グループ（35秒後）");
await go(ALBUM_A, "→ アルバムA（35秒後）");

await browser.close();
