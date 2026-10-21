// B: 実ブラウザで主要ページを開き、ページ例外・ハイドレーションエラーを拾う。
import { encode } from "next-auth/jwt";
import { writeResults } from "./_results.mjs";
import { watchPageErrors, writePageErrors } from "./_pageerrors.mjs";

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
  //   - YouTubeのサムネイル（i.ytimg.com）など: サンドボックスから外へ出られないので必ず失敗する
  //     （埋め込み本体は youtube.com/embed。そこから出るエラーは下の THIRD_PARTY_FRAMES で除く）。**アプリ側は
  //     iframeのsrcを組み立てるだけ**なので、ここで確認できるのはURLが正しいことまで。
  //     実際に再生できるかは本番でしか見られない（README参照）。
  /youtube-nocookie\.com/,
  /i\.ytimg\.com/,
];

// **埋め込んだ YouTube の中から出たコンソールのエラーは数えない。** 関連動画は `youtube.com/embed` の iframe で、
// 手元は外へ出られないので読み込まれないが、**CIは外へ出られるので本物のプレーヤーが動く。**
// そのプレーヤーが iframe で許されていない機能を呼ぶと、Chrome が
// 「Permissions policy violation: compute-pressure is not allowed in this document.」のように出す
// （2026-10-20 に CI の B08 がこれで落ちた。B08 の提案は採用済みで、動画のあるゲーム詳細へ転送される）。
// アプリが直せるものではなく、YouTube 側の更新次第で出たり出なかったりする。判定は**出どころ（location）で**行う
// （文言で消すと、同じ文言をアプリが出したときまで見逃す）
const THIRD_PARTY_FRAMES = [/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//, /^https:\/\/[^/]*\.(ytimg|googlevideo)\.com\//];

/** 数えなくてよいコンソールのエラーか（アプリの不具合ではないと分かっているもの） */
function isIgnoredConsole(m) {
  const text = m.text();
  const from = m.location()?.url ?? "";
  if (IGNORED.some((re) => re.test(text))) return true;
  if (text.includes("Failed to load resource") && IGNORED.some((re) => re.test(from))) return true;
  return THIRD_PARTY_FRAMES.some((re) => re.test(from));
}

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
  watchPageErrors(page, problems);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (isIgnoredConsole(m)) return;
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
  // **ブロックごと try/catch で包む。** 途中のクリックで止まると、以降のスイートが1件も走らずに落ちる
  // （デザイン刷新の段階5の壊し確認で、ゲームのタブが出ない版を流したら実際にそうなった。docs/lessons.md）
  const BLOCK = {
    B20: "ゲーム一覧の初期フィルタが「プレイ中」「プレイ予定」だけ",
    B21: "初期状態で積みゲー・クリア済みは出ない",
    B22: "「すべて」を押すと積みゲー・クリア済みも出る"
  };
  const before = rows.length;
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}?tab=games`, { waitUntil: "networkidle" });
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
      item: "ゲーム一覧の初期フィルタが「プレイ中」「プレイ予定」だけ",
      expected: "プレイ中・プレイ予定が選択済み",
      actual: pressed.join(",") || "なし",
      ok: pressed.includes("プレイ中") && pressed.includes("プレイ予定") && !pressed.includes("積みゲー"),
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

  } catch (e) {
    const done = new Set(rows.slice(before).map((r) => r.id));
    for (const [id, item] of Object.entries(BLOCK)) {
      if (!done.has(id)) rows.push({ id, item, expected: "—", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    await page.close();
  }
}

// ── 絞り込みの保存（localStorage） ──
{
  const page = await context.newPage();
  // **ブロックごと try/catch で包む。** 途中のクリックで止まると、以降のスイートが1件も走らずに落ちる
  // （デザイン刷新の段階5の壊し確認で、ゲームのタブが出ない版を流したら実際にそうなった。docs/lessons.md）
  const BLOCK = {
    B23: "絞り込みがグループ単位のキーで保存される",
    B24: "リロードしても前回の絞り込みが復元される",
    B25: "保存を消すと既定（プレイ中・プレイ予定）に戻る",
    B26: "復元でハイドレーションのずれが出ない"
  };
  const before = rows.length;
  try {
    const url = `${BASE}/groups/${ids.groupId}?tab=games`;
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
      item: "保存を消すと既定（プレイ中・プレイ予定）に戻る",
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

  } catch (e) {
    const done = new Set(rows.slice(before).map((r) => r.id));
    for (const [id, item] of Object.entries(BLOCK)) {
      if (!done.has(id)) rows.push({ id, item, expected: "—", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    await page.close();
  }
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
  await page.goto(`${BASE}/groups/${ids.groupId}?tab=albums`, { waitUntil: "networkidle" });
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
  // **時間ではなく「保存が終わって編集欄が閉じた」ことを待つ。** 編集欄は PATCH の応答を
  // 受けてから閉じるので、固定の900msだとCIで応答が遅い回に編集中のまま読んで落ちた
  // （表の備考に「18/500 保存」＝編集欄の文字数表示が出ていた）
  await page
    .locator(`${LIGHTBOX} textarea`)
    .waitFor({ state: "detached", timeout: 10000 })
    .catch(() => {});

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
  // 通知の設定はグループの設定画面（歯車の先）にある。最初から開いた形（デザイン刷新の段階5で見出しの下から移した）
  const page = await context.newPage();
  await page.goto(`${BASE}/groups/${ids.groupId}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const counter = () => page.getByTestId("notification-counter").textContent().then((t) => (t ?? "").trim());

  // 文言の正本は apps/web/src/lib/notificationTargets.ts の NOTIFICATION_KINDS。種類の数（B61・B62 の「1/4」）もここから取る。
  // ここはブラウザ側のスクリプトでTSを読めないので書き写している
  // （種類を入れ替えたときにここだけ古くなり、実際に1件落ちて気づいた）
  const labels = [
    "ゲームが提案されたとき",
    "ウィッシュリストが最安値を更新したとき",
    "週に一度のまとめ",
    "プレイ記録の開始と終了",
  ];
  const shown = [];
  for (const l of labels) shown.push(await page.getByText(l, { exact: true }).count());
  rows.push({
    id: "B59",
    item: "通知の設定に4種類が並ぶ",
    expected: "4種類とも出る",
    actual: `${shown.filter((n) => n > 0).length}/4`,
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
  await page.waitForTimeout(400);
  const counterText = await counter();
  const saved = await page.getByLabel("ゲームが提案されたとき").inputValue();
  rows.push({
    id: "B61",
    item: "選んだ通知先が保存され、再読み込みしても残る",
    expected: "900000000000000012 / 1種類がオン",
    actual: `${saved} / ${counterText.trim()}`,
    ok: saved === "900000000000000012" && counterText.includes(`1/${labels.length}`),
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
    actual: await counter(),
    ok: (await counter()).includes(`0/${labels.length}`) && cleared,
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
  watchPageErrors(page, problems);
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
  watchPageErrors(page, problems);
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
  watchPageErrors(page, problems);

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

  await page.goto(`${BASE}/groups/${ids.groupId}?tab=wishlist`, { waitUntil: "networkidle" });

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

  // 区画の見出しは「名前・N件」（2026-10-18 に「ゲーム提案」を「ウィッシュリスト」へ改名し、「・提案N件」から変えた）
  const sectionCount = await page.getByText(/^.+・\d+件$/).count();
  const mineHeading = await page.getByText(/（あなた）・\d+件$/).count();
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
  watchPageErrors(page, problems);

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
// スマホのナビゲーションとスクロール（B84〜B93）
//
// 2026-10 のデザイン刷新で、ハンバーガーとドロワーをやめて下のタブ（BottomTabs）にした。
// **このスイートは最初から 390×844（スマホ相当）で走っている**ので、ここで見るのはタブ側。
// PC幅（1280px）は下で別の context を作って骨組みだけ見る——
// 768px以上を壊しても、390pxだけ見ていると誰も気づけない。
//
// ブロックごと try/catch で包んである。**入口ごとにガードを置くのでは足りない**
// （クリックの連鎖はどこで止まっても以降が全部消える。docs/lessons.md）
{
  // 項目名はIDで引く（添字で引くと、順番を入れ替えた瞬間に別の項目名が入る）
  const EXPECTED = {
    B84: "スマホ幅では左のメニューが出ない",
    B85: "スマホ幅では下のタブ5つ（ホーム・グループ・投稿・アルバム・自分）が文字つきで画面の下端に出る（ハンバーガーは無い）",
    B86: "タブで遷移し、今いるタブにだけ印が付く",
    B87: "「自分」タブから自分のページが開き、ログアウトと管理（管理者だけ）が出る",
    B88: "ページのいちばん下（フッター）がタブの裏に隠れない",
    B89: "「自分」から開く画面（設定・使い方）にいる間も「自分」のタブに印が付く",
    B90: "下のタブと本文の下の余白が iPhone のホームバーの高さ（safe-area-inset-bottom）を足す指定になっている",
    B91: "横スクロールが出ない（スマホ幅・表のあるページ）",
    B92: "本文は window がスクロールする（高さを固定したスクローラを作っていない）",
    B93: "ナビの操作で例外が出ない",
  };
  const recorded = new Set();
  // **記録した順ではなくID順で表に入れる。** 確認の都合で順番が前後するため、
  // そのまま push すると表の行がID順にならず読みにくい（レビューで指摘された）
  const localRows = [];
  const rec = (id, expected, actual, ok, note = "") => {
    recorded.add(id);
    localRows.push({ id, item: EXPECTED[id], expected, actual, ok, note });
  };
  const flushRows = () => {
    localRows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    rows.push(...localRows);
    localRows.length = 0;
  };
  const TAB_LABELS = ["ホーム", "グループ", "投稿", "アルバム", "自分"];
  // 今いるタブ（aria-current="page"）の名前の一覧
  const currentTabs = (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll('[data-testid="bottom-tabs"] a[aria-current="page"]')].map((a) => a.textContent.trim())
    );

  const page = await context.newPage();
  const problems = [];
  watchPageErrors(page, problems);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (isIgnoredConsole(m)) return;
    problems.push(text.slice(0, 140));
  });

  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

    const rail = page.locator("aside");
    const railVisible = (await rail.count()) > 0 && (await rail.first().isVisible());
    rec("B84", "出ていない", railVisible ? "出ている" : "出ていない", !railVisible);

    // **画面の下端に付いていることまで見る。** ヘッダーのように `backdrop-filter` を持つ箱の中に置くと、
    // `fixed` が画面ではなくその箱に対して効き、文字もリンクも揃っているのに変な場所に出る（ドロワーで一度やらかした）
    const tabs = page.locator('[data-testid="bottom-tabs"]');
    const tabTexts = (await tabs.count()) > 0 ? (await tabs.getByRole("link").allInnerTexts()).map((t) => t.trim()) : [];
    const tabsBox = (await tabs.count()) > 0 ? await tabs.boundingBox() : null;
    const viewportHeight = page.viewportSize().height;
    const atBottom = tabsBox !== null && Math.abs(tabsBox.y + tabsBox.height - viewportHeight) <= 1;
    const hamburgerCount = await page.getByRole("button", { name: "メニューを開く" }).count();
    rec(
      "B85",
      `${TAB_LABELS.join("・")} / 下端 / ハンバーガー無し`,
      `${tabTexts.join("・") || "タブ無し"} / 下端=${tabsBox ? Math.round(tabsBox.y + tabsBox.height) : "-"}（画面${viewportHeight}） / ハンバーガー${hamburgerCount}件`,
      JSON.stringify(tabTexts) === JSON.stringify(TAB_LABELS) && atBottom && hamburgerCount === 0
    );

    await tabs.getByRole("link", { name: "アルバム" }).click();
    await page.waitForURL("**/albums", { timeout: 15000 });
    await page.waitForTimeout(300);
    const afterAlbums = await currentTabs(page);
    rec(
      "B86",
      "/albums / 印はアルバムだけ",
      `${new URL(page.url()).pathname} / 印: ${afterAlbums.join("・") || "なし"}`,
      new URL(page.url()).pathname === "/albums" && JSON.stringify(afterAlbums) === JSON.stringify(["アルバム"])
    );

    await tabs.getByRole("link", { name: "自分" }).click();
    await page.waitForURL("**/me", { timeout: 15000 });
    await page.waitForTimeout(300);
    const afterMe = await currentTabs(page);
    const signOut = await page.getByRole("button", { name: "ログアウト" }).count();
    const adminLink = await page.locator('main a[href="/admin"]').count();
    rec(
      "B87",
      "/me / 印は自分だけ / ログアウトあり / 管理あり（admin で見ている）",
      `${new URL(page.url()).pathname} / 印: ${afterMe.join("・") || "なし"} / ログアウト${signOut}件 / 管理${adminLink}件`,
      new URL(page.url()).pathname === "/me" && JSON.stringify(afterMe) === JSON.stringify(["自分"]) && signOut === 1 && adminLink === 1
    );

    // 「自分」から開いた先でもタブの印が消えないこと（どこにも印が無いと、今どこにいるのか分からない）
    const subCurrent = [];
    for (const path of ["/settings/discord", "/manual"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      subCurrent.push(`${path}=${(await currentTabs(page)).join("・") || "なし"}`);
    }
    rec("B89", "どちらも 自分", subCurrent.join(" / "), subCurrent.every((s) => s.endsWith("=自分")));

    // **いちばん下まで送ったとき、フッターがタブの裏に隠れていないこと。** 本文の下を空けていないと、
    // ページの最後のボタンが押せなくなる。矩形の比較に加え、その位置で実際に一番上にいるのがフッターかを見る
    await page.goto(`${BASE}/manual`, { waitUntil: "networkidle" });
    const footerState = await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 300));
      const footer = document.querySelector("footer");
      const tabsEl = document.querySelector('[data-testid="bottom-tabs"]');
      if (!footer || !tabsEl) return { ok: false, detail: "フッターかタブが無い" };
      const f = footer.getBoundingClientRect();
      // **タブの上端は、帯ではなく一番上に出ている部品で測る。** 真ん中の「投稿」の丸は帯から20px上に出ていて、
      // 帯の上端だけで比べていたときは、丸がフッターの文字に重なっているのに通っていた（段階5の画面写真で見つかった）
      const tabsTop = Math.min(...[tabsEl, ...tabsEl.querySelectorAll("*")].map((el) => el.getBoundingClientRect().top));
      const at = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
      return {
        ok: f.bottom <= tabsTop + 1 && (at === footer || footer.contains(at)),
        detail: `フッター下端=${Math.round(f.bottom)} / タブ（出っぱりを含む）上端=${Math.round(tabsTop)} / その位置=${at?.tagName.toLowerCase() ?? "なし"}`,
      };
    });
    rec("B88", "フッター下端 ≤ タブ（出っぱりを含む）上端 / その位置にフッター", footerState.detail, footerState.ok);

    // **env(safe-area-inset-bottom) は Chromium では0なので、効いた結果は測れない。** 指定そのものを見る。
    // `viewport-fit=cover` が無いと iPhone でもこの値は0のままなので、viewport の指定も合わせて見る
    const safeArea = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
      const tabsEl = document.querySelector('[data-testid="bottom-tabs"]');
      const column = document.querySelector("footer")?.parentElement;
      const uses = (el) => {
        if (!el) return false;
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            // メディアクエリの中（md:pb-0 など）は数えない。外側の規則だけを見る
            if (!rule.selectorText || !rule.style) continue;
            if (rule.style.paddingBottom.includes("safe-area-inset-bottom") && el.matches(rule.selectorText)) return true;
          }
        }
        return false;
      };
      return { cover: /viewport-fit=cover/.test(meta), tabs: uses(tabsEl), column: uses(column) };
    });
    rec(
      "B90",
      "viewport-fit=cover / タブ・本文の下の余白とも指定あり",
      `cover=${safeArea.cover} / タブ=${safeArea.tabs} / 本文=${safeArea.column}`,
      safeArea.cover && safeArea.tabs && safeArea.column
    );

    // **横スクロールが出ないこと。** `/admin/users` は中に min-w-[820px] の表がある。
    // 抑えているのは `app/(main)/layout.tsx` の内側 div（`overflow-y-auto` が
    // `overflow-x` も `auto` にする）。そこを外すとページ全体が横に流れる
    const widths = [];
    for (const path of ["/", "/admin/users", "/me"]) {
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
      "ページが伸びていて window がスクロールする",
      `伸びている=${scrollState.scrollable} / scrollY=${scrollState.scrollY}`,
      scrollState.scrollable && scrollState.scrollY > 0
    );

    rec("B93", "無し", problems.slice(0, 3).join(" / ") || "無し", problems.length === 0);
  } catch (e) {
    for (const [id, item] of Object.entries(EXPECTED)) {
      if (recorded.has(id)) continue;
      localRows.push({
        id,
        item,
        expected: "—",
        actual: "未確認",
        ok: false,
        note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}`,
      });
    }
  } finally {
    flushRows();
    await page.close();
  }
}

// PC幅（1280px）の骨組み。**390pxだけ見ていると768px以上を壊しても気づけない。**
{
  // 他の2ブロックと同じ形に揃える。**項目名を記録側と catch 側の2箇所に書いていたのが
  // 欠陥の温床だった**（`localRows` に移したのに catch の判定は `rows` のままで、
  // 途中で落ちると記録済みの行まで「未確認」で二重に積まれる形になっていた）
  const EXPECTED = {
    B94: "PC幅では左のメニューが出ていて、全部の項目に名前が文字で出ている",
    B95: "PC幅では下のタブも上のヘッダーも出ない",
    B96: "PC幅で横スクロールが出ない",
    B97: "PC幅で長いページをスクロールしてもメニューが残る",
    B98: "PC幅ではアカウントが左下に1つ出ていて、押すと自分のページが開く",
    B128: "PCの左メニューにある行き先は、スマホでもタブか「自分」ページから全部行ける",
    B129: "プロフィールで表示名を変えると、ログインし直さなくても左下の名前が変わる（ブラウザから送った名前は使われない）",
    B130: "「たたむ」でアイコンだけの細い列になり、アイコンに乗せると名前が実際に読める",
    B131: "畳んだ状態は再読み込みしても残り、サーバーの最初の描画から畳んだ形で出る（画面の食い違いが出ない）",
    B132: "「広げる」で名前付きに戻り、再読み込みしても広がったまま",
  };
  const recorded = new Set();
  // 確認の都合で順番が前後するので、ID順に並べ直してから表へ入れる
  const localRows = [];
  const rec = (id, expected, actual, ok, note = "") => {
    recorded.add(id);
    localRows.push({ id, item: EXPECTED[id], expected, actual, ok, note });
  };
  const flushRows = () => {
    localRows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    rows.push(...localRows);
    localRows.length = 0;
  };
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
  const phonePage = await context.newPage();
  try {
    await pcPage.goto(`${BASE}/`, { waitUntil: "networkidle" });

    // **名前が「文字として読める」ことまで見る。** 以前はアイコンだけのレールで、名前はホバーのツールチップにしか無かった。
    // リンクの数だけを見ると、アイコンだけに戻っても通ってしまう。admin なので 5 + 2 + 管理 = 8項目（navItems.ts）
    const rail = pcPage.locator("aside");
    const railVisible = (await rail.count()) > 0 && (await rail.first().isVisible());
    const items = railVisible
      ? await pcPage.evaluate(() =>
          [...document.querySelectorAll('aside nav a')].map((a) => {
            const label = [...a.querySelectorAll("span")].find((s) => s.textContent.trim());
            const r = label?.getBoundingClientRect();
            return { text: label?.textContent.trim() ?? "", visible: !!r && r.width > 0 && r.right <= window.innerWidth && getComputedStyle(label).opacity === "1" };
          })
        )
      : [];
    const readable = items.filter((i) => i.text && i.visible);
    rec(
      "B94",
      "出ている / 8項目すべてに名前",
      `${railVisible ? "出ている" : "出ていない"} / ${items.length}項目・名前あり${readable.length}`,
      railVisible && items.length === 8 && readable.length === 8,
      readable.map((i) => i.text).join(",")
    );

    const tabsVisible = await pcPage.locator('[data-testid="bottom-tabs"]').isVisible().catch(() => false);
    const headerCount = await pcPage.locator("header").count();
    rec(
      "B95",
      "タブ無し / ヘッダー無し",
      `タブ${tabsVisible ? "出ている" : "無し"} / ヘッダー${headerCount}件`,
      !tabsVisible && headerCount === 0
    );

    // アカウントは左下。押すと「自分」ページ（設定・使い方・ログアウト）へ行く
    const account = pcPage.locator('[data-testid="sidebar-account"]');
    const accountCount = await account.count();
    const accountBox = accountCount > 0 ? await account.boundingBox() : null;
    const vh = pcPage.viewportSize().height;
    const bottomLeft = accountBox !== null && accountBox.x < 240 && accountBox.y + accountBox.height >= vh - 40;
    let landed = "";
    if (accountCount === 1) {
      await account.click();
      await pcPage.waitForURL("**/me", { timeout: 15000 }).catch(() => {});
      landed = new URL(pcPage.url()).pathname;
    }
    rec(
      "B98",
      "1つ / 左下 / /me へ",
      `${accountCount}つ / ${accountBox ? `x=${Math.round(accountBox.x)} 下端=${Math.round(accountBox.y + accountBox.height)}（画面${vh}）` : "-"} / ${landed || "-"}`,
      accountCount === 1 && bottomLeft && landed === "/me"
    );

    // **左下の名前は DB の表示名。** 以前はログイン時の Discord の名前のままで、プロフィールで変えても
    // 「自分」ページ（DBの表示名）と食い違っていた。保存すると画面がセッションの更新を呼び、サーバーが DB から読み直す。
    // 更新の要求にはブラウザが好きな名前を載せられるので、それが左下に出ないことも見る。作業後は元の名前に戻す
    {
      const NEW_NAME = "左下確認テスト";
      const FORGED = "偽の名前テスト";
      const accountText = async () => (await pcPage.locator('[data-testid="sidebar-account"]').innerText()).replace(/\s+/g, " ");
      const original = await pcPage.evaluate(async () => (await (await fetch("/api/users/me")).json())?.user?.name ?? null);
      try {
        await pcPage.goto(`${BASE}/settings/profile`, { waitUntil: "networkidle" });
        await pcPage.getByPlaceholder("表示名を入力").fill(NEW_NAME);
        await pcPage.getByRole("button", { name: "変更を保存" }).click();
        await pcPage.getByText("プロフィールを更新しました").waitFor({ timeout: 10000 });
        await pcPage.waitForTimeout(800);
        const afterSave = await accountText();
        // 偽の更新: NextAuth の update() と同じ要求を、名前を載せて直接送る
        await pcPage.evaluate(async (forged) => {
          const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
          await fetch("/api/auth/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ csrfToken, data: { name: forged } }),
          });
        }, FORGED);
        await pcPage.reload({ waitUntil: "networkidle" });
        const afterForged = await accountText();
        rec(
          "B129",
          `保存後に「${NEW_NAME}」/ 偽の更新のあとも「${FORGED}」は出ない`,
          `保存後: ${afterSave} / 偽の更新後: ${afterForged}`,
          afterSave.includes(NEW_NAME) && !afterForged.includes(FORGED) && afterForged.includes(NEW_NAME)
        );
      } finally {
        if (original) {
          await pcPage
            .evaluate(async (name) => {
              await fetch("/api/users/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
              const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
              await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrfToken, data: {} }) });
            }, original)
            .catch(() => {});
        }
      }
    }

    // **PCで行ける場所はスマホでも全部行けること。** タブは5つしか無いので、残りは「自分」ページが拾う。
    // 片方だけに項目を足すと、画面幅で行ける場所が変わる（CLAUDE.md「ナビの項目は navItems.ts が正本」）
    await pcPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const pcHrefs = await pcPage.evaluate(() => [...new Set([...document.querySelectorAll("aside a")].map((a) => a.getAttribute("href")))]);
    await phonePage.goto(`${BASE}/me`, { waitUntil: "networkidle" });
    const phoneHrefs = await phonePage.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[data-testid="bottom-tabs"] a, main a')]
          .filter((a) => a.getBoundingClientRect().width > 0)
          .map((a) => a.getAttribute("href"))
      ),
    ]);
    // ロゴ（/）はタブの「ホーム」と同じ行き先なので、別扱いしなくても突き合わせに入る
    const unreachable = pcHrefs.filter((h) => !phoneHrefs.includes(h));
    rec(
      "B128",
      "行けない行き先 0件",
      unreachable.length === 0 ? `0件（PC ${pcHrefs.length}か所）` : `${unreachable.length}件: ${unreachable.join(", ")}`,
      pcHrefs.length >= 8 && unreachable.length === 0,
      `スマホ: ${phoneHrefs.join(" ")}`.slice(0, 200)
    );

    // **長いページでメニューが流れていかないこと。** `sticky top-0 h-[100dvh]` で画面に残す。
    // これが無いと親のフレックスに引き伸ばされ、スクロールすると上に抜けていく（PCでだけ起きる）
    await pcPage.goto(`${BASE}/manual`, { waitUntil: "networkidle" });
    await pcPage.evaluate(() => window.scrollTo(0, 900));
    await pcPage.waitForTimeout(300);
    // **`isVisible()` では測れない。** Playwright の可視判定はビューポート内かを見ないので、
    // 上に抜けていったリンクも「見えている」と返る（これで一度誤判定した）。
    // 画面内に居るかは bounding box の y で見る
    const navAfterScroll = pcPage.locator("aside").getByRole("link", { name: "ShareStaq ホーム" });
    const box = (await navAfterScroll.count()) > 0 ? await navAfterScroll.boundingBox() : null;
    const scrolled = await pcPage.evaluate(() => Math.round(window.scrollY));
    const navStays = box !== null && box.y >= 0 && box.y < vh;
    rec(
      "B97",
      "画面内に居る",
      box === null ? "リンクが無い" : `y=${Math.round(box.y)}（scrollY=${scrolled} / 画面高=${vh}）`,
      navStays && scrolled > 0
    );

    await pcPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const pcWidth = await pcPage.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    rec(
      "B96",
      "溢れなし",
      `${pcWidth.scrollWidth}/${pcWidth.clientWidth}`,
      pcWidth.scrollWidth <= pcWidth.clientWidth + 1
    );

    // ── 左メニューの折りたたみ（2026-10-21 ユーザー判断: ボタンで開閉・初めては開いた形） ──
    // 畳んだときの名前は、メニューの外に出す吹き出しだけが頼り。**`opacity` と矩形は「出ている」と答えるのに
    // 画面には無い**、という壊れ方をする（`<nav>` の `overflow-y-auto` が吹き出しを切る。以前のレールで実際に起きた）
    // ので、その位置に本当に居るかを `elementFromPoint` で見る。最後は必ず広げた形に戻す
    {
      const hydration = [];
      pcPage.on("console", (m) => {
        if (m.type() === "error" && /#418|#422|#423|#425|hydrat/i.test(m.text())) hydration.push(m.text().slice(0, 120));
      });
      const asideWidth = () => pcPage.locator("aside").evaluate((el) => Math.round(el.getBoundingClientRect().width));
      try {
        await pcPage.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
        await pcPage.getByRole("button", { name: "メニューをたたむ" }).click();
        await pcPage.waitForTimeout(400);
        const collapsedWidth = await asideWidth();
        await pcPage.locator("aside nav").getByRole("link", { name: "アルバム" }).hover();
        await pcPage.waitForTimeout(400);
        const tooltip = await pcPage.evaluate(() => {
          const tip = [...document.querySelectorAll("aside nav span")].find((e) => e.textContent === "アルバム");
          if (!tip) return { found: false, opacity: null, hit: false };
          const r = tip.getBoundingClientRect();
          // 吹き出しには `pointer-events-none` が付いている。**`elementFromPoint` はそれを飛ばして下の要素を返す**ので、
          // 測る間だけ戻す（以前、直っているのに落ち続けた）
          const previous = tip.style.pointerEvents;
          tip.style.pointerEvents = "auto";
          const at = document.elementFromPoint(r.x + 5, r.y + r.height / 2);
          tip.style.pointerEvents = previous;
          return { found: true, opacity: getComputedStyle(tip).opacity, hit: at === tip || tip.contains(at) };
        });
        rec(
          "B130",
          "幅80px以下 / 吹き出しがその位置に居る",
          `幅${collapsedWidth}px / ${tooltip.found ? `opacity=${tooltip.opacity} その位置に居る=${tooltip.hit}` : "吹き出しが無い"}`,
          collapsedWidth <= 80 && tooltip.found && tooltip.opacity === "1" && tooltip.hit
        );

        // サーバーが返すHTMLの時点で畳んだ形か（ブラウザで描き直して畳むのでは、開いた瞬間に一度広がる）
        const html = await (await pcContext.request.get(`${BASE}/groups/${ids.groupId}`)).text();
        const ssrCollapsed = /<aside[^>]*data-collapsed="true"/.test(html);
        hydration.length = 0;
        await pcPage.reload({ waitUntil: "networkidle" });
        await pcPage.waitForTimeout(300);
        const afterReload = await asideWidth();
        rec(
          "B131",
          "サーバーのHTMLで畳んだ形 / 再読み込み後も80px以下 / 食い違い0件",
          `HTML=${ssrCollapsed ? "畳んだ形" : "開いた形"} / 幅${afterReload}px / 食い違い${hydration.length}件`,
          ssrCollapsed && afterReload <= 80 && hydration.length === 0,
          hydration.slice(0, 2).join(" | ")
        );

        await pcPage.getByRole("button", { name: "メニューを広げる" }).click();
        await pcPage.waitForTimeout(400);
        const expandedWidth = await asideWidth();
        await pcPage.reload({ waitUntil: "networkidle" });
        await pcPage.waitForTimeout(300);
        const expandedAfterReload = await asideWidth();
        const labelVisible = await pcPage.locator("aside nav").getByText("アルバム", { exact: true }).isVisible();
        rec(
          "B132",
          "広げた直後も再読み込み後も200px以上 / 名前が出ている",
          `直後${expandedWidth}px / 再読み込み後${expandedAfterReload}px / 名前${labelVisible ? "あり" : "なし"}`,
          expandedWidth >= 200 && expandedAfterReload >= 200 && labelVisible
        );
      } finally {
        await pcPage.evaluate(() => (document.cookie = "ss-sidebar=; path=/; max-age=0")).catch(() => {});
      }
    }
  } catch (e) {
    for (const [id, item] of Object.entries(EXPECTED)) {
      if (recorded.has(id)) continue;
      localRows.push({
        id,
        item,
        expected: "—",
        actual: "未確認",
        ok: false,
        note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}`,
      });
    }
  } finally {
    flushRows();
    await phonePage.close();
    await pcPage.close();
    await pcContext.close();
  }
}

// ───────────────────────────────────────────────────────────────
// Lightbox のスワイプ送り（B99〜B107）
//
// **専用の context を作る。** 既存の390pxの context に `hasTouch` を足すと
// 83件すべての環境が変わる（タッチ端末扱いになると hover の挙動が変わるものがある）。
//
// スワイプは `page.touchscreen` では出せない（tap しか無い）ので、CDP の
// `Input.dispatchTouchEvent` でブラウザ層の本物のタッチを送る。**自分で
// `dispatchEvent` した合成イベントでは、自分のハンドラを呼んだだけになり
// 「ジェスチャが効く」ことの確認にならない。**
{
  // **項目名は配列の添字で引かない。** 以前そうしていて、途中で項目を1つ挟んだときに
  // B106 に B108 の名前が入った（表に同じ名前の行が2つ並ぶ）。IDで引けばずれない
  const EXPECTED = {
    B99: "スワイプ用のデータが用意できる（アルバムと写真3枚）",
    B100: "払っている最中はメディアが指に追従する",
    B101: "左へ払うと次のメディアになる",
    B102: "右へ払うと前のメディアに戻る",
    B103: "閾値に届かない払いでは切り替わらない",
    B104: "縦に払っても切り替わらない",
    B105: "最後のメディアで左へ払っても変わらない",
    B106: "矢印ボタンは従来どおり動く",
    B107: "スワイプ操作で例外が出ない",
    B108: "背景を払っても閉じない・ページを離れない（タップでは閉じる）",
  };
  const recorded = new Set();
  // **記録した順ではなくID順で表に入れる。** 確認の都合で順番が前後するため、
  // そのまま push すると表の行がID順にならず読みにくい（レビューで指摘された）
  const localRows = [];
  const rec = (id, expected, actual, ok, note = "") => {
    recorded.add(id);
    localRows.push({ id, item: EXPECTED[id], expected, actual, ok, note });
  };
  const flushRows = () => {
    localRows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    rows.push(...localRows);
    localRows.length = 0;
  };

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await touchContext.addCookies([
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
  const page = await touchContext.newPage();
  const problems = [];
  watchPageErrors(page, problems);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (isIgnoredConsole(m)) return;
    problems.push(text.slice(0, 140));
  });

  let swipeAlbumId = null;
  const createdPhotoIds = [];

  try {
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

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

    // **要るデータは自分で作る。** seedのアルバムは前のスイートが写真を足したり消したり
    // するので、枚数も並びも当てにできない（docs/lessons.md）
    swipeAlbumId = (
      await callApi("/api/albums", "POST", { title: "スワイプ確認用アルバム", groupId: ids.groupId })
    ).json?.album?.id;

    for (let i = 1; i <= 3; i += 1) {
      const bytes = Buffer.from(`swipe-png-${i}-0123456789`);
      const signed = await callApi("/api/photos/upload-url", "POST", {
        contentType: "image/png",
        mediaType: "IMAGE",
        sizeBytes: bytes.length,
      });
      const uploadUrl = signed.json?.upload?.url;
      if (!uploadUrl) break;
      // ストレージへのPUTはブラウザからだと別オリジンになるので Node 側から送る
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(bytes.length) },
        body: bytes,
      });
      const made = await callApi("/api/photos", "POST", {
        contentType: "image/png",
        mediaUrl: signed.json.publicUrl,
        sizeBytes: bytes.length,
        albumId: swipeAlbumId,
        gameTitle: `スワイプ${i}`,
      });
      if (made.json?.photo?.id) createdPhotoIds.push(made.json.photo.id);
    }

    rec(
      "B99",
      "アルバム1件 / 写真3枚",
      `アルバム=${swipeAlbumId ? "作れた" : "作れない"} / 写真${createdPhotoIds.length}枚`,
      Boolean(swipeAlbumId) && createdPhotoIds.length === 3
    );

    await page.goto(`${BASE}/albums/${swipeAlbumId}`, { waitUntil: "networkidle" });
    await page.locator("main img").first().click();
    await page.waitForSelector("div.fixed.inset-0.z-50", { timeout: 10000 });

    const mediaBox = "div.fixed.inset-0.z-50 > div.relative";
    const shownUrl = () =>
      page.evaluate((sel) => document.querySelector(`${sel} img`)?.getAttribute("src") ?? null, mediaBox);
    const transform = () =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).transform : "要素なし";
      }, mediaBox);

    // **払う座標はメディアの箱の中から取る。** 外側（背景）で払うと、確認したいのが
    // 送りなのか背景タップなのか混ざる（最初はそれで B102 以降が全部崩れた）。
    // テスト用の画像は中身がPNGではないので読み込みに失敗し、箱は読み込み中の
    // プレースホルダ（50vw × 50vh）のまま。そこを基準にする
    const box = await page.locator(mediaBox).boundingBox();
    const midY = box ? Math.round(box.y + box.height / 2) : 420;
    const leftX = box ? Math.round(box.x + box.width * 0.15) : 110;
    const rightX = box ? Math.round(box.x + box.width * 0.85) : 280;

    const cdp = await touchContext.newCDPSession(page);
    /** 指1本で (fromX,fromY) から (toX,toY) へ払う。離すまでの途中で onMid を呼ぶ */
    async function swipe(fromX, fromY, toX, toY, onMid) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: fromX, y: fromY }],
      });
      const steps = 4;
      for (let i = 1; i <= steps; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: fromX + ((toX - fromX) * i) / steps,
              y: fromY + ((toY - fromY) * i) / steps,
            },
          ],
        });
      }
      if (onMid) await onMid();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    }

    const first = await shownUrl();

    // 払っている最中の追従。閾値（画面幅の15%＝約59px）を十分に超える量で動かす
    let midTransform = "未取得";
    await swipe(rightX, midY, leftX, midY, async () => {
      midTransform = await transform();
    });
    rec(
      "B100",
      "translateX が付いている",
      midTransform,
      midTransform.startsWith("matrix(") && !midTransform.startsWith("matrix(1, 0, 0, 1, 0, 0)")
    );

    const second = await shownUrl();
    rec(
      "B101",
      "別のメディアになる",
      first === second ? "変わらない" : "変わった",
      Boolean(first) && Boolean(second) && first !== second
    );

    await swipe(leftX, midY, rightX, midY);
    const backToFirst = await shownUrl();
    rec(
      "B102",
      "1枚目に戻る",
      backToFirst === first ? "戻った" : "戻らない",
      backToFirst === first
    );

    // 閾値（約59px）に届かない払い
    await swipe(rightX, midY, rightX - 30, midY);
    const afterSmall = await shownUrl();
    const restedTransform = await transform();
    rec(
      "B103",
      "変わらない / 位置も戻る",
      `${afterSmall === first ? "変わらない" : "変わった"} / transform=${restedTransform}`,
      afterSmall === first && (restedTransform === "none" || restedTransform === "matrix(1, 0, 0, 1, 0, 0)")
    );

    // 縦の払い（説明パネルを縦に動かしたいときに送られては困る）
    await swipe(Math.round((leftX + rightX) / 2), midY + 150, Math.round((leftX + rightX) / 2), midY - 150);
    const afterVertical = await shownUrl();
    rec(
      "B104",
      "変わらない",
      afterVertical === first ? "変わらない" : "変わった",
      afterVertical === first
    );

    // 最後まで送ってから、さらに左へ払う
    await swipe(rightX, midY, leftX, midY);
    await swipe(rightX, midY, leftX, midY);
    const last = await shownUrl();
    await swipe(rightX, midY, leftX, midY);
    const afterEdge = await shownUrl();
    rec(
      "B105",
      "変わらない",
      afterEdge === last ? "変わらない" : "変わった",
      Boolean(last) && afterEdge === last
    );

    // **背景を払っても、閉じない・ページを離れないこと。** 落とし穴が2つある:
    //   1. タッチ操作の最後にブラウザが click を合成するので、何もしないと
    //      「背景タップ＝閉じる」が走る
    //   2. Chromium は横のオーバースクロールを「スワイプで戻る」として扱うので、
    //      `touch-action: pan-y` が無いと**前のページへ遷移する**（実測で空のページに飛んだ）
    // どちらも「Lightboxが消える」という同じ見え方になるので、URLまで見て区別する。
    // **座標を決め打ちにしない。** 下部の❤️と説明のパネルは中身で高さが変わるので、
    // 「メディアの箱の下＋40px」のような固定値だとパネルの上を叩くことがある
    // （2回目の通しだけ「タップしても閉じない」で落ちた）。
    // オーバーレイ自身がその点に居ることを `elementFromPoint` で確かめてから使う
    const backdrop = await page.evaluate((sel) => {
      const ov = document.querySelector(sel);
      const b = document.querySelector(`${sel} > div.relative`)?.getBoundingClientRect();
      const cx = Math.round(window.innerWidth / 2);
      const rows = [];
      if (b) {
        rows.push(Math.round(b.y / 2)); // 箱の上の余白
        rows.push(Math.round(b.bottom + (window.innerHeight - b.bottom) / 2)); // 箱の下の余白
      }
      rows.push(Math.round(window.innerHeight / 2));
      for (const y of rows) {
        // 払う始点・終点・タップ点のどれもオーバーレイでなければ使えない
        const xs = [70, cx, 340];
        if (xs.every((x) => document.elementFromPoint(x, y) === ov)) {
          return { y, at: "overlay" };
        }
      }
      // 見つからなければ、何に当たっているかを返して原因が分かるようにする
      const y = rows[0] ?? 100;
      const hit = document.elementFromPoint(70, y);
      return { y, at: `${hit?.tagName}.${(hit?.className ?? "").toString().split(" ")[0]}` };
    }, "div.fixed.inset-0.z-50");

    const backdropY = backdrop.y;
    const urlBeforeBackdrop = new URL(page.url()).pathname;
    const beforeBackdrop = await shownUrl();
    await swipe(70, backdropY, 340, backdropY);
    const openAfterBackdropSwipe = (await page.locator("div.fixed.inset-0.z-50").count()) > 0;
    const urlAfterBackdrop = new URL(page.url()).pathname;
    const movedByBackdrop = openAfterBackdropSwipe ? await shownUrl() : null;
    // 背景をタップしたら閉じる（こちらは従来どおり壊していないこと）。
    //
    // **払った直後にタップしてはいけない。** ブラウザはダブルタップかどうかを待つため、
    // 直前のジェスチャから間を置かないと **click を一切合成しない**（手元の Chromium では
    // 0ms・400msで click 0件、800msで1件）。アプリ側の問題ではない。
    //
    // **待ち時間で解決しようとして2回失敗した。** 900msに延ばしても、CIの Chrome 154 では
    // まだ落ちた（手元は Playwright の Chromium で版が違う）。**時間に頼らず、前の
    // ジェスチャが残っていない状態を作り直してから**タップする
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("main img").first().click();
    await page.waitForSelector("div.fixed.inset-0.z-50", { timeout: 10000 });
    const tapY = await page.evaluate((sel) => {
      const ov = document.querySelector(sel);
      const b = document.querySelector(`${sel} > div.relative`)?.getBoundingClientRect();
      const y = b ? Math.round(b.y / 2) : 100;
      return document.elementFromPoint(70, y) === ov ? y : Math.round(window.innerHeight / 2);
    }, "div.fixed.inset-0.z-50");
    await page.touchscreen.tap(70, tapY);
    await page.waitForTimeout(500);
    const closedByTap = (await page.locator("div.fixed.inset-0.z-50").count()) === 0;
    rec(
      "B108",
      "開いたまま / 同じURL / 前のメディアへ / タップで閉じる",
      `払った後=${openAfterBackdropSwipe ? "開いている" : "閉じた"} / URL=${
        urlBeforeBackdrop === urlAfterBackdrop ? "同じ" : `${urlBeforeBackdrop}→${urlAfterBackdrop}`
      } / 送り=${beforeBackdrop === movedByBackdrop ? "変わらず" : "変わった"} / タップ後=${
        closedByTap ? "閉じた" : "開いている"
      }`,
      openAfterBackdropSwipe &&
        urlBeforeBackdrop === urlAfterBackdrop &&
        Boolean(movedByBackdrop) &&
        movedByBackdrop !== beforeBackdrop &&
        closedByTap,
      `払った位置 y=${backdropY}（${backdrop.at}） / タップ位置 y=${tapY}`
    );

    // 矢印ボタン（スワイプを足したことで壊していないか）。タップで閉じたので開き直す。
    // **閉じ切れていなければ先にEscで閉じる**——開いたままだとサムネイルのクリックが
    // オーバーレイに遮られ、ここから先が全部「未確認」になる
    if ((await page.locator("div.fixed.inset-0.z-50").count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await page.locator("main img").first().click();
    await page.waitForSelector("div.fixed.inset-0.z-50", { timeout: 10000 });
    const beforeArrow = await shownUrl();
    await page.getByRole("button", { name: "次の写真" }).click();
    await page.waitForTimeout(300);
    const afterArrow = await shownUrl();
    rec(
      "B106",
      "次のメディアになる",
      afterArrow === beforeArrow ? "変わらない" : "変わった",
      Boolean(beforeArrow) && Boolean(afterArrow) && afterArrow !== beforeArrow
    );

    rec("B107", "無し", problems.slice(0, 3).join(" / ") || "無し", problems.length === 0);
  } catch (e) {
    for (const [id, item] of Object.entries(EXPECTED)) {
      if (recorded.has(id)) continue;
      localRows.push({
        id,
        item,
        expected: "—",
        actual: "未確認",
        ok: false,
        note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}`,
      });
    }
  } finally {
    flushRows();
    // 後片付けは作ったときと同じ経路（API）で。DB直で消すとキャッシュが飛ばず、
    // 次に走るスイートが消えた写真をクリックして落ちる（docs/lessons.md）
    try {
      for (const id of createdPhotoIds) {
        await page.evaluate((pid) => fetch(`/api/photos/${pid}`, { method: "DELETE" }), id);
      }
      if (swipeAlbumId) {
        await page.evaluate((aid) => fetch(`/api/albums/${aid}`, { method: "DELETE" }), swipeAlbumId);
      }
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
    await touchContext.close();
  }
}

// ── 管理者のメディア一覧から未分類を振り分ける（チェック → まとめて振り分け → モーダル） ──
// 他の人の投稿を移せる権限は flows（F277・F278）で見ている。ここは画面の配線
// （チェック・下の操作バー・モーダル・移した後に一覧から消える）を見る
{
  const page = await context.newPage();
  const problems = [];
  watchPageErrors(page, problems);
  const made = [];
  let albumId = null;
  const callApi = (path, method, body) =>
    page.evaluate(
      async ([p, m, b]) => {
        const res = await fetch(p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) };
      },
      [path, method, body ?? null]
    );
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    albumId = (await callApi("/api/albums", "POST", { title: "振り分け確認用アルバム", groupId: ids.groupId })).json?.album?.id;
    for (const label of ["甲", "乙"]) {
      const bytes = Buffer.from(`assign-browser-${label}-0123456789`);
      const signed = await callApi("/api/photos/upload-url", "POST", { contentType: "image/png", mediaType: "IMAGE", sizeBytes: bytes.length });
      await fetch(signed.json.upload.url, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": String(bytes.length) },
        body: bytes,
      });
      const p = await callApi("/api/photos", "POST", { contentType: "image/png", mediaUrl: signed.json.publicUrl, sizeBytes: bytes.length, gameTitle: `画面振り分け${label}` });
      if (p.json?.photo?.id) made.push(p.json.photo.id);
    }

    await page.goto(`${BASE}/admin/media?album=none`, { waitUntil: "networkidle" });
    const rowOf = (label) => page.locator("tr", { hasText: `画面振り分け${label}` });

    // 1件だけの「振り分け」はモーダルを開き、Escで閉じる（ページは離れない）
    await rowOf("甲").getByRole("button", { name: "アルバムに振り分け" }).click();
    const singleTitle = (await page.getByRole("dialog").textContent()) ?? "";
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = (await page.getByRole("dialog").count()) === 0 && page.url().includes("/admin/media");
    rows.push({
      id: "B109",
      item: "メディア一覧の未分類の「振り分け」でモーダルが開き（1件）、Escで閉じる",
      expected: "（1件）が出て、閉じてもページに留まる",
      actual: `${singleTitle.includes("（1件）") ? "1件" : singleTitle.slice(0, 40)} / 閉じた=${closed}`,
      ok: singleTitle.includes("（1件）") && closed,
      note: "",
    });

    // 2件をチェック → 下の操作バー → モーダルでグループとアルバムを選んで移す → 一覧から消える
    await rowOf("甲").getByRole("checkbox").check();
    await rowOf("乙").getByRole("checkbox").check();
    const bar = (await page.getByText("未分類 2件を選択中").count()) > 0;
    await page.getByRole("button", { name: /まとめて振り分け/ }).click();
    const dialog = page.getByRole("dialog");
    const bulkTitle = (await dialog.textContent()) ?? "";
    await dialog.locator("#admin-assign-group").selectOption(ids.groupId);
    await dialog.locator("#admin-assign-album").selectOption(albumId);
    await dialog.getByRole("button", { name: "振り分ける" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await rowOf("甲").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const gone = (await rowOf("甲").count()) === 0 && (await rowOf("乙").count()) === 0;

    await page.goto(`${BASE}/admin/media`, { waitUntil: "networkidle" });
    const inAlbum = ((await rowOf("甲").textContent()) ?? "").includes("振り分け確認用アルバム");
    rows.push({
      id: "B110",
      item: "未分類を2件チェックして「まとめて振り分け」→ モーダルで選んで移すと、未分類の一覧から消えてアルバムに入る",
      expected: "操作バー・（2件）・移した後に消える・アルバム名が付く",
      actual: `バー=${bar} / ${bulkTitle.includes("（2件）") ? "2件" : "件数なし"} / 消えた=${gone} / アルバム=${inAlbum}`,
      ok: bar && bulkTitle.includes("（2件）") && gone && inAlbum,
      note: problems.slice(0, 2).join(" / "),
    });
  } catch (e) {
    for (const id of ["B109", "B110"]) {
      if (rows.some((r) => r.id === id)) continue;
      rows.push({ id, item: "未分類の振り分け（メディア一覧）", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    // 作ったものは同じ経路（API）で消す（docs/lessons.md）
    try {
      for (const id of made) await callApi(`/api/photos/${id}`, "DELETE");
      if (albumId) await callApi(`/api/albums/${albumId}`, "DELETE");
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── ログイン画面のエラーメッセージ（本人向けの文言か） ──
// 以前は環境変数名や設定手順（`NEXTAUTH_URL` を設定し…）を、ログインしようとしている友人に出していた。
// signIn が例外を投げると NextAuth はその例外メッセージを `?error=` に入れてくるので、
// 知らないコードの中身を画面に出さないことも見る。ログイン画面は描画がクライアント側なので実ブラウザで見る
{
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await anon.newPage();
  const DEV_WORDS = /NEXTAUTH|DISCORD_CLIENT|Vercel|環境変数|YOUR_DOMAIN|リダイレクト URI|prisma|invocation/i;
  const alertText = async (code) => {
    await page.goto(`${BASE}/login?error=${encodeURIComponent(code)}`, { waitUntil: "networkidle" });
    const alert = page.getByRole("alert");
    return (await alert.count()) > 0 ? ((await alert.first().textContent()) ?? "") : "";
  };
  try {
    const cases = {
      OAuthCallback: await alertText("OAuthCallback"),
      Configuration: await alertText("Configuration"),
      AccessDenied: await alertText("AccessDenied"),
      junk: await alertText("\nInvalid `prisma.user.update()` invocation: Unique constraint failed"),
    };
    const leaked = Object.entries(cases).filter(([, t]) => DEV_WORDS.test(t)).map(([k]) => k);
    const ok =
      leaked.length === 0 &&
      cases.OAuthCallback.includes("もう一度") && cases.OAuthCallback.includes("エラーコード: OAuthCallback") &&
      cases.Configuration.includes("管理者に連絡") &&
      cases.AccessDenied.includes("招待されていません") &&
      cases.junk.includes("ログインに失敗しました") && !cases.junk.includes("エラーコード");
    rows.push({
      id: "B111",
      item: "ログイン失敗の表示が本人向けの文言で、環境変数名や例外メッセージを出さない（切り分け用のコードだけ小さく添える）",
      expected: "開発者向けの語なし・コードごとの案内・知らないコードは中身を出さない",
      actual: leaked.length ? `開発者向けの語が出た: ${leaked.join(", ")}` : Object.entries(cases).map(([k, t]) => `${k}=${t.slice(0, 18)}`).join(" / "),
      ok,
      note: ok ? "" : JSON.stringify(cases).slice(0, 300),
    });
  } catch (e) {
    rows.push({ id: "B111", item: "ログイン失敗の表示（本人向けの文言）", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await anon.close();
  }
}

// ── 管理者のプレイ記録の画面：追加 → 修正 → 削除がモーダルから通る ──
// API の中身は flows の F293〜F296 で見ている。ここは画面の配線（モーダルの入力が API に渡り、一覧に反映されるか）だけ
{
  const page = await context.newPage();
  // 3日前の 20:00〜21:30（JST）。他の記録と取り違えないよう日時で行を探す
  const day = new Date(Date.now() + 9 * 3600000 - 3 * 86400000).toISOString().slice(0, 10);
  const [, mm, dd] = day.split("-").map(Number);
  const rowOf = () => page.locator("li[data-play-session]", { hasText: `${mm}/${dd}(` }).filter({ hasText: "20:00" });
  let stage = "開く";
  try {
    await page.goto(`${BASE}/admin/play-log?group=${ids.groupId}`, { waitUntil: "networkidle" });
    stage = "追加";
    await page.getByRole("button", { name: "記録を追加" }).click();
    const dialog = page.getByRole("dialog");
    const gameOptions = await dialog.locator("#play-game option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    await dialog.locator("#play-game").selectOption(gameOptions[0]);
    await dialog.locator("#play-start").fill(`${day}T20:00`);
    await dialog.locator("#play-end").fill(`${day}T21:30`);
    await dialog.locator('input[type="checkbox"]').first().check();
    await dialog.getByRole("button", { name: "追加する" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    await rowOf().first().waitFor({ timeout: 10000 });
    const addedText = (await rowOf().first().textContent()) ?? "";

    stage = "修正";
    await rowOf().first().getByRole("button", { name: /記録を修正/ }).click();
    const edit = page.getByRole("dialog");
    await edit.locator("#play-end").fill(`${day}T22:00`);
    await edit.getByRole("button", { name: "保存する" }).click();
    await edit.waitFor({ state: "detached", timeout: 10000 });
    await page.waitForFunction(() => document.body.innerText.includes("2時間"), null, { timeout: 10000 }).catch(() => {});
    const editedText = (await rowOf().first().textContent()) ?? "";

    stage = "削除";
    page.once("dialog", (d) => d.accept());
    await rowOf().first().getByRole("button", { name: /記録を削除/ }).click();
    await rowOf().first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const left = await rowOf().count();

    const ok = addedText.includes("1時間30分") && addedText.includes("手動で追加") && editedText.includes("2時間") && !editedText.includes("2時間30分") && left === 0;
    rows.push({
      id: "B112",
      item: "管理者のプレイ記録の画面で、モーダルから記録を追加・修正・削除でき、一覧に反映される",
      expected: "追加=1時間30分（手動で追加）→ 修正=2時間 → 削除で消える",
      actual: `追加=${addedText.includes("1時間30分")} / 修正=${editedText.includes("2時間")} / 残り=${left}`,
      ok,
      note: ok ? "" : `${addedText.slice(0, 80)} || ${editedText.slice(0, 80)}`,
    });
  } catch (e) {
    rows.push({ id: "B112", item: "管理者のプレイ記録の画面（追加・修正・削除）", expected: "-", actual: "未確認", ok: false, note: `「${stage}」で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    // 残っていたら画面の削除ボタンで消す（作ったのと同じ経路。docs/lessons.md）
    try {
      await page.goto(`${BASE}/admin/play-log?group=${ids.groupId}`, { waitUntil: "networkidle" });
      for (let i = 0; i < 5 && (await rowOf().count()) > 0; i++) {
        page.once("dialog", (d) => d.accept());
        await rowOf().first().getByRole("button", { name: /記録を削除/ }).click();
        await page.waitForTimeout(1500);
        await page.reload({ waitUntil: "networkidle" });
      }
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── グループ画面の帯（合計プレイ時間）とゲーム一覧の時間（docs/play-log.md §13） ──
// 数え方は lib-checks の F298、HTMLの値は flows の F297。ここは実際の描画：帯がアルバムより上に出て、
// いちばん遊んだゲームへのリンクがあり、ゲーム一覧のカードに時間が出ること
{
  const page = await context.newPage();
  let sessionId = null;
  let visibleCards = [];
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
    // **一覧に今見えているカードから選ぶ。** 特定のゲーム（seed の ELDEN RING）を決め打ちにすると、
    // それまでのスイートがステータスを変えた・キャッシュに古いステータスが残った、で一覧の初期の絞り込みから外れ、
    // カードが見つからずに落ちる（CIで1回そうなった。手元では再現しなかった）
    visibleCards = await page.evaluate((gid) =>
      [...document.querySelectorAll(`a[href^="/groups/${gid}/games/"]`)]
        .filter((a) => (a.textContent ?? "").includes("が追加"))
        .map((a) => ({ id: a.getAttribute("href").split("/").pop(), text: (a.textContent ?? "").slice(0, 30) })),
    ids.groupId);
    const gameId = visibleCards[0]?.id;
    if (!gameId) throw new Error("一覧にカードが1枚も見えていない");
    // 管理者のAPIで記録を足す（作ったのと同じ経路で消す。docs/lessons.md）
    const start = new Date(Date.now() - 4 * 86400000);
    const created = await page.evaluate(async ([groupId, gameId, adminId, startIso, endIso]) => {
      const res = await fetch("/api/admin/play-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, groupGameId: gameId, startedAt: startIso, endedAt: endIso, participantIds: [adminId] }),
      });
      return res.ok ? (await res.json()).id : null;
    }, [ids.groupId, gameId, ids.adminId, start.toISOString(), new Date(start.getTime() + 100 * 60000).toISOString()]);
    sessionId = created;
    await page.reload({ waitUntil: "networkidle" });
    const banner = page.getByTestId("play-total-banner");
    const bannerText = (await banner.count()) > 0 ? ((await banner.textContent()) ?? "") : "";
    const bannerBox = (await banner.count()) > 0 ? await banner.boundingBox() : null;
    // 帯は「ようす」の区画の先頭に置く（デザイン刷新の段階5。スマホはタブ、PCは右の列の先頭）。
    // 以前は「アルバムより上」を見ていたが、スマホではアルバムは別のタブなので比べられない
    const bannerFirst = (await banner.count()) > 0
      ? await banner.evaluate((el) => !!el.closest('[data-tab="overview"]') && el.parentElement?.firstElementChild === el)
      : false;
    const topLink = await banner.getByRole("link").count();
    // 同じゲーム詳細へのリンクは帯にもあるので、一覧のカード（「〇〇が追加」がある方）に絞る
    const card = page.locator(`a[href="/groups/${ids.groupId}/games/${gameId}"]`).filter({ hasText: "が追加" }).first();
    const cardText = (await card.count()) > 0 ? ((await card.textContent()) ?? "") : "";
    // カードの時間は遊んだアイコン（以前は🎮の絵文字。デザイン刷新の段階2でアイコンにした）＋時間
    const cardPlay = (await card.count()) > 0 && (await card.locator('[data-play-ms] [data-kind="play.session"]').count()) > 0;
    const ok =
      !!created && bannerText.includes("グループで遊んだ時間") && bannerText.includes("時間") &&
      !!bannerBox && bannerFirst && topLink === 1 && cardPlay;
    rows.push({
      id: "B113",
      item: "グループ画面の「ようす」の先頭に「グループで遊んだ時間」の帯が出て、いちばん遊んだゲームへのリンクがあり、ゲーム一覧のカードに時間が出る",
      expected: "帯あり・「ようす」の先頭・リンク1つ・カードに遊んだ時間",
      actual: `記録=${!!created} / 帯=${bannerText.slice(0, 40)} / 先頭=${bannerFirst} / リンク=${topLink} / カード=${cardPlay}`,
      ok,
      // 落ちたときの手掛かり：見えていたカード（ゲームID末尾と文字）
      note: ok ? "" : `カード=${cardText.slice(0, 60)} / 見えていた=${visibleCards.map((c) => `${c.id.slice(-4)}:${c.text}`).join(", ").slice(0, 160)}`,
    });
  } catch (e) {
    rows.push({ id: "B113", item: "グループ画面の帯とゲーム一覧の時間", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)} / 見えていた=${visibleCards.length}枚` });
  } finally {
    try {
      if (sessionId) await page.evaluate((id) => fetch(`/api/admin/play-sessions/${id}`, { method: "DELETE" }), sessionId);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── 活動カレンダーのプレイ記録（docs/play-log.md §11 の段階1） ──
// 中身は lib-checks の F299・flows の F300。ここは実際の描画：スマホ幅（このコンテキストは390px）で
// 日のマスの「🎮2h44m」が切れずに読めること。1行に入らず「🎮2h44…」になっていた（2026-10-18）
{
  const page = await context.newPage();
  let sessionId = null;
  try {
    const startJstDay = new Date(Date.now() + 9 * 3600000 - 4 * 86400000).toISOString().slice(0, 10);
    const start = new Date(`${startJstDay}T21:00:00.000+09:00`);
    await page.goto(`${BASE}/admin/activity?group=${ids.groupId}&month=${startJstDay.slice(0, 7)}`, { waitUntil: "networkidle" });
    // 管理者のAPIで記録を足す（作ったのと同じ経路で消す。docs/lessons.md）
    sessionId = await page.evaluate(async ([groupId, gameId, adminId, startIso, endIso]) => {
      const res = await fetch("/api/admin/play-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, groupGameId: gameId, startedAt: startIso, endedAt: endIso, participantIds: [adminId] }),
      });
      return res.ok ? (await res.json()).id : null;
    }, [ids.groupId, ids.gameId, ids.adminId, start.toISOString(), new Date(start.getTime() + 164 * 60000).toISOString()]);
    await page.reload({ waitUntil: "networkidle" });
    const fit = await page.evaluate((day) => {
      const cell = [...document.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").endsWith(`date=${day}`));
      const play = cell?.querySelector("[data-play-ms]");
      if (!cell || !play) return null;
      // **マスの外枠ではなく、余白と枠線を除いた内側と比べる。** 外枠と比べていたら、1行に詰めた「🎮2h44m」（38px）が
      // 内側（34px）からはみ出して枠線に食い込んでいるのに通った（折り返しを止めたビルドで確かめた）
      const c = cell.getBoundingClientRect();
      const st = getComputedStyle(cell);
      const left = c.left + parseFloat(st.borderLeftWidth) + parseFloat(st.paddingLeft);
      const right = c.right - parseFloat(st.borderRightWidth) - parseFloat(st.paddingRight);
      const parts = [...play.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, inside: r.left >= left - 0.5 && r.right <= right + 0.5, clipped: el.scrollWidth > el.clientWidth + 0.5 };
      });
      return { text: play.textContent, icon: !!play.querySelector('[data-kind="play.session"]'), cellWidth: Math.round(right - left), parts };
    }, startJstDay);
    // 部品は🎮・時間・分の3つ（文字を12pxに上げたとき「2h44m」だけで36pxになり、時間と分も折り返せるように分けた。
    // 数は決め打ちせず、つなげると「🎮2h44m」になること・1つも外に出ず切れていないことを見る）
    // 🎮は絵文字ではなくアイコンになった（デザイン刷新の段階2）ので、文字は「2h44m」、アイコンは印（data-kind）で見る
    const ok = !!sessionId && !!fit && fit.icon && fit.parts.map((p) => p.text).join("") === "2h44m" && fit.parts.length >= 2 && fit.parts.every((p) => p.inside && !p.clipped);
    rows.push({
      id: "B114",
      item: "活動カレンダーの日のマスに遊んだアイコンと時間が出て、スマホ幅でも時間が切れずにマスの中に収まる",
      expected: "遊んだアイコンと 2h44m がマスの中・切れない",
      actual: fit ? `アイコン=${fit.icon} ${fit.text} / マスの内側=${fit.cellWidth}px / ${fit.parts.map((p) => `${p.text}:${p.inside ? "中" : "はみ出し"}${p.clipped ? "・切れ" : ""}`).join(" ")}` : `記録=${!!sessionId} / マスが見つからない`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B114", item: "活動カレンダーの日のマスのプレイ時間", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    try {
      if (sessionId) await page.evaluate((id) => fetch(`/api/admin/play-sessions/${id}`, { method: "DELETE" }), sessionId);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── グループ画面の「最近の動き」（docs/play-log.md §11 の段階2） ──
// 中身は lib-checks の F301・flows の F302。ここは実際の描画：スマホ幅（390px）で欄がアルバムより上に出て、
// 横にはみ出さず、「カレンダーで見る」でグループの活動カレンダーに移れること
{
  const page = await context.newPage();
  let sessionId = null;
  try {
    // 前のスイートが出来事を残している前提にしない。遊んだ記録を1件、管理者のAPIで足す（同じ経路で消す。docs/lessons.md）
    await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
    const start = new Date(Date.now() - 2 * 3600000);
    sessionId = await page.evaluate(async ([groupId, gameId, adminId, startIso, endIso]) => {
      const res = await fetch("/api/admin/play-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, groupGameId: gameId, startedAt: startIso, endedAt: endIso, participantIds: [adminId] }),
      });
      return res.ok ? (await res.json()).id : null;
    }, [ids.groupId, ids.gameId, ids.adminId, start.toISOString(), new Date(start.getTime() + 40 * 60000).toISOString()]);
    await page.reload({ waitUntil: "networkidle" });
    const section = page.getByTestId("recent-activity");
    const present = (await section.count()) > 0;
    const box = present ? await section.boundingBox() : null;
    // 「最近の動き」は「ようす」の区画に置く（デザイン刷新の段階5）。以前は「アルバムより上」を見ていた
    const inOverview = present ? await section.evaluate((el) => !!el.closest('[data-tab="overview"]')) : false;
    const count = present ? await section.locator("li[data-kind]").count() : 0;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    let moved = "";
    let heading = "";
    if (present) {
      await section.getByRole("link", { name: /カレンダーで見る/ }).click();
      await page.waitForURL(/\/activity/, { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
      moved = new URL(page.url()).pathname;
      heading = ((await page.locator("main h1").first().textContent()) ?? "").trim();
    }
    const ok = !!box && inOverview && count >= 1 && count <= 5 && !overflow &&
      moved === `/groups/${ids.groupId}/activity` && heading.includes("活動カレンダー");
    rows.push({
      id: "B115",
      item: "グループ画面の「最近の動き」が「ようす」に1〜5件出て、スマホ幅で横にはみ出さず、「カレンダーで見る」でグループの活動カレンダーに移れる",
      expected: "「ようす」の中・1〜5件・はみ出しなし・/activity へ移る",
      actual: `欄=${present} / ようす=${inOverview} / 件数=${count} / はみ出し=${overflow} / 移動先=${moved} / 見出し=${heading}`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B115", item: "グループ画面の「最近の動き」", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    try {
      if (sessionId) await page.evaluate((id) => fetch(`/api/admin/play-sessions/${id}`, { method: "DELETE" }), sessionId);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── グループ画面の見出しの大きさを「最近の動き」に揃える／「ゲーム提案」→「ウィッシュリスト」（2026-10-18 ユーザー判断） ──
{
  const page = await context.newPage();
  let sessionId = null;
  try {
    // 「最近の動き」が必ず出るように、遊んだ記録を1件足す（作ったのと同じ経路で消す。docs/lessons.md）
    await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
    const start = new Date(Date.now() - 2 * 3600000);
    sessionId = await page.evaluate(async ([groupId, gameId, adminId, startIso, endIso]) => {
      const res = await fetch("/api/admin/play-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, groupGameId: gameId, startedAt: startIso, endedAt: endIso, participantIds: [adminId] }),
      });
      return res.ok ? (await res.json()).id : null;
    }, [ids.groupId, ids.gameId, ids.adminId, start.toISOString(), new Date(start.getTime() + 40 * 60000).toISOString()]);
    await page.reload({ waitUntil: "networkidle" });
    const sizes = await page.evaluate(() => {
      const size = (el) => (el ? getComputedStyle(el).fontSize : null);
      const heads = [...document.querySelectorAll("main h2")];
      const byText = (t) => heads.find((h) => (h.textContent ?? "").trim() === t);
      return {
        recent: size(byText("最近の動き")),
        album: size(byText("アルバム")),
        games: size(byText("みんなのゲーム")),
        wishlist: size(byText("ウィッシュリスト")),
        oldName: heads.some((h) => (h.textContent ?? "").includes("ゲーム提案")),
      };
    });
    const ok = !!sizes.recent && sizes.album === sizes.recent && sizes.games === sizes.recent && sizes.wishlist === sizes.recent && !sizes.oldName;
    rows.push({
      id: "B116",
      item: "グループ画面の「アルバム」「みんなのゲーム」「ウィッシュリスト」の見出しが「最近の動き」と同じ大きさで、「ゲーム提案」の見出しは残っていない",
      expected: "4つとも同じ文字の大きさ・旧名なし",
      actual: `最近の動き=${sizes.recent} / アルバム=${sizes.album} / みんなのゲーム=${sizes.games} / ウィッシュリスト=${sizes.wishlist} / 旧名=${sizes.oldName}`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B116", item: "グループ画面の見出しの大きさ", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    try {
      if (sessionId) await page.evaluate((id) => fetch(`/api/admin/play-sessions/${id}`, { method: "DELETE" }), sessionId);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── ゲーム詳細のプレイ履歴は枠の中でスクロールする（2026-10-18 ユーザー判断） ──
// 記録を8回ぶん足して、一覧が縦に伸びず（枠の高さで止まり）、中身は枠の中でスクロールできること
{
  const page = await context.newPage();
  const made = [];
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}/games/${ids.gameId}`, { waitUntil: "networkidle" });
    for (let i = 0; i < 8; i++) {
      const start = new Date(Date.now() - (30 + i) * 86400000);
      const id = await page.evaluate(async ([groupId, gameId, adminId, startIso, endIso]) => {
        const res = await fetch("/api/admin/play-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, groupGameId: gameId, startedAt: startIso, endedAt: endIso, participantIds: [adminId] }),
        });
        return res.ok ? (await res.json()).id : null;
      }, [ids.groupId, ids.gameId, ids.adminId, start.toISOString(), new Date(start.getTime() + 60 * 60000).toISOString()]);
      if (id) made.push(id);
    }
    await page.reload({ waitUntil: "networkidle" });
    const list = page.getByTestId("group-play-sessions");
    const m = (await list.count()) > 0
      ? await list.evaluate((el) => {
          const before = el.scrollTop;
          el.scrollTop = el.scrollHeight;
          return { rows: el.children.length, client: el.clientHeight, scroll: el.scrollHeight, moved: el.scrollTop > before, overflowY: getComputedStyle(el).overflowY };
        })
      : null;
    const ok = made.length === 8 && !!m && m.rows >= 8 && m.scroll > m.client && m.moved && m.overflowY === "auto";
    rows.push({
      id: "B117",
      item: "ゲーム詳細のプレイ履歴が縦に伸びず、枠の中でスクロールして見られる",
      expected: "8回ぶん並び・枠より中身が高く・枠の中でスクロールできる",
      actual: m ? `記録=${made.length} / 行=${m.rows} / 枠=${m.client}px 中身=${m.scroll}px / スクロール=${m.moved} / overflow-y=${m.overflowY}` : `記録=${made.length} / 一覧が無い`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B117", item: "ゲーム詳細のプレイ履歴のスクロール", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    try {
      for (const id of made) await page.evaluate((x) => fetch(`/api/admin/play-sessions/${x}`, { method: "DELETE" }), id);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── 「ゲームを追加」を「みんなのゲーム」の見出しの横に置く（2026-10-18 ユーザー判断） ──
// アルバムの「新規アルバム」と同じ並び（見出しと同じ行）にあり、区画を畳んでいても押せば開いて検索モーダルが出ること
{
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}?tab=games`, { waitUntil: "networkidle" });
    const head = page.locator("main h2").filter({ hasText: /^みんなのゲーム$/ }).first();
    const addButton = page.getByRole("button", { name: "ゲームを追加" });
    const count = await addButton.count();
    const headBox = await head.boundingBox();
    const buttonBox = count === 1 ? await addButton.boundingBox() : null;
    // 同じ行＝縦の中心が見出しの高さの中に入っている
    const sameRow = !!headBox && !!buttonBox && Math.abs(headBox.y + headBox.height / 2 - (buttonBox.y + buttonBox.height / 2)) < headBox.height;
    // 畳んでから押す
    await head.getByRole("button").click();
    const collapsed = (await page.getByPlaceholder("ゲーム名で検索").count()) === 0 && (await page.getByText("全ジャンル").count()) === 0;
    if (count === 1) await addButton.click();
    const modal = page.getByRole("heading", { name: "ゲームをリストに追加" });
    await modal.waitFor({ timeout: 5000 }).catch(() => {});
    const modalShown = (await modal.count()) > 0;
    const reopened = (await page.getByText("全ジャンル").count()) > 0;
    if (modalShown) await page.getByRole("button", { name: "閉じる" }).first().click();
    const ok = count === 1 && sameRow && collapsed && modalShown && reopened;
    rows.push({
      id: "B118",
      item: "「ゲームを追加」が「みんなのゲーム」の見出しと同じ行にあり、区画を畳んでいても押すと開いて検索モーダルが出る",
      expected: "ボタン1つ・見出しと同じ行・畳んだ後に押すと区画が開きモーダルが出る",
      actual: `ボタン=${count} / 同じ行=${sameRow} / 畳めた=${collapsed} / モーダル=${modalShown} / 区画が開いた=${reopened}`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B118", item: "「ゲームを追加」の位置", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// ── ウィッシュリストのカードに価格を出す（2026-10-19 ユーザー判断: 見せ方は A「1行の文字」、最安値はSteamだけ） ──
// 価格はカードが出てからあとで読み込む。スマホ幅でも4つの部分（今の値段・割引率・最安値・印）が切れずに1行に収まること。
// seed の提案は前のスイートで決着しうるので、自分でグループと提案を作る（stub: ¥4,730・-45%・Steamの最安値 ¥4,730）
{
  const page = await context.newPage();
  let priceGroupId = null;
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "networkidle" });
    priceGroupId = await page.evaluate(async (name) => {
      const res = await fetch("/api/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const group = res.ok ? (await res.json()).group : null;
      if (!group) return null;
      await fetch(`/api/groups/${group.id}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steamAppId: 1245620, title: "ELDEN RING" }),
      });
      return group.id;
    }, `価格の表示テスト-${Date.now()}`);
    await page.goto(`${BASE}/groups/${priceGroupId}?tab=wishlist`, { waitUntil: "networkidle" });
    const line = page.getByTestId("wishlist-price").first();
    await line.waitFor({ timeout: 8000 }).catch(() => {});
    const m = (await line.count()) > 0
      ? await line.evaluate((el) => ({
          text: el.textContent,
          parts: Array.from(el.children).map((c) => ({ t: c.textContent, cut: c.scrollWidth > c.clientWidth })),
          lineCut: el.scrollWidth > el.clientWidth,
          pageWide: document.documentElement.scrollWidth > window.innerWidth,
        }))
      : null;
    const texts = m ? m.parts.map((x) => x.t) : [];
    const ok = !!priceGroupId && !!m &&
      texts.join("|") === "¥4,730|-45%|· 最安 ¥4,730|最安値" &&
      m.parts.every((x) => !x.cut) && !m.lineCut && !m.pageWide;
    rows.push({
      id: "B119",
      item: "ウィッシュリストのカードに「今の値段・割引率・Steamの最安値・最安値の印」が1行で出て、スマホ幅でも切れない",
      expected: "¥4,730|-45%|· 最安 ¥4,730|最安値・どれも切れない・横にはみ出さない",
      actual: m ? `${texts.join("|")} / 切れ=${m.parts.filter((x) => x.cut).map((x) => x.t).join(",") || "なし"} / 行が切れ=${m.lineCut} / 横はみ出し=${m.pageWide}` : `グループ=${!!priceGroupId} / 価格の行が出ない`,
      ok,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B119", item: "ウィッシュリストのカードの価格", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    try {
      if (priceGroupId) await page.evaluate((id) => fetch(`/api/groups/${id}`, { method: "DELETE" }), priceGroupId);
    } catch {
      // 片付けに失敗しても結果の表は残す
    }
    await page.close();
  }
}

// ── 「3時間前」の表示でハイドレーションが食い違わない（B93 が時々落ちていた原因） ──
// アルバムのカードはクライアント部品（AlbumSearch・ExpandableAlbumGrid）の中で描かれる。
// そこで Date.now() から「N分前」を計算していたため、サーバーとブラウザの間で分や時間の境目を
// またいだ回だけ文字が食い違い、React #425/#422 が出ていた（B93 の「ナビの開閉で例外が出ない」で /albums を開いたとき）。
// 境目は偶然にしかまたがないので、**ブラウザの時計だけを40日進めて**必ずまたがせる。直す前のビルドでは毎回落ちる
{
  const shifted = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await shifted.addCookies(await context.cookies());
  await shifted.addInitScript(() => {
    const real = Date.now;
    Date.now = () => real() + 40 * 24 * 60 * 60 * 1000;
  });
  const page = await shifted.newPage();
  const problems = [];
  watchPageErrors(page, problems, "B120");
  try {
    const seen = [];
    // グループ画面のアルバムはスマホではタブの中なので、アルバムのタブを開く（デザイン刷新の段階5）
    for (const path of ["/albums", `/groups/${ids.groupId}?tab=albums`]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      // カードが出ていないと何も確かめていないことになるので、「〜前」が描かれていることも見る
      const labels = await page.evaluate(() => (document.querySelector("main")?.innerText.match(/(たった今|\d+(分|時間|日|ヶ月|年)前)/g) ?? []).length);
      seen.push(`${path.startsWith("/groups") ? "グループ" : "/albums"}=${labels}件`);
    }
    const allShown = seen.every((x) => !x.endsWith("=0件"));
    rows.push({
      id: "B120",
      item: "ブラウザの時計がずれていても、アルバムのカードの「〜前」の表示で例外が出ない（/albums・グループ画面）",
      expected: "例外なし・どちらのページもカードの「〜前」が出ている",
      actual: `${problems.slice(0, 2).join(" / ") || "例外なし"} / ${seen.join(" ")}`,
      ok: problems.length === 0 && allShown,
      note: "",
    });
  } catch (e) {
    rows.push({ id: "B120", item: "アルバムのカードのハイドレーション", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await shifted.close();
  }
}

// ── ゲーム詳細の「情報を更新」がハイドレーションで食い違わない（B08 を追っていて見つけた） ──
// RefreshGameDataButton は (1) 日時をタイムゾーン指定なしで文字にしていたため、サーバー（Vercel は UTC）と
// ブラウザ（日本）で必ず違う文字になり（#425）、(2)「まだ更新できない」をブラウザの時計で判定していたため、
// 時計がずれていると「次に更新できるのは…」の行の有無が食い違っていた（#418）。どちらも #422 を伴う。
// このテスト環境はサーバーもブラウザも UTC なので、**ブラウザだけを日本時間にする／時計だけをずらす**ことで起こす。
// 直前に「情報を更新」を押して、最終更新の時刻がある・まだ更新できない状態を作ってから開く
{
  const gamePath = `/groups/${ids.groupId}/games/${ids.gameId}`;
  const prep = await context.newPage();
  let prepared = "未実行";
  try {
    await prep.goto(BASE + gamePath, { waitUntil: "networkidle" });
    // 429（直近に更新済み）でも「まだ更新できない」状態になっているので、どちらでもよい
    prepared = String(await prep.evaluate((u) => fetch(u, { method: "POST" }).then((r) => r.status), `/api/groups/${ids.groupId}/games/${ids.gameId}/refresh`));
  } catch (e) {
    prepared = `失敗: ${String(e.message ?? e).slice(0, 60)}`;
  } finally {
    await prep.close();
  }

  const cases = [
    { id: "B121", item: "ブラウザが日本時間でも、ゲーム詳細の「最終更新」の日時で例外が出ない", options: { timezoneId: "Asia/Tokyo" }, shiftMs: 0 },
    { id: "B122", item: "ブラウザの時計がずれていても、ゲーム詳細の「次に更新できるのは…」で例外が出ない", options: {}, shiftMs: 24 * 60 * 60 * 1000 + 60 * 1000 },
  ];
  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...c.options });
    await ctx.addCookies(await context.cookies());
    if (c.shiftMs) {
      await ctx.addInitScript((ms) => {
        const real = Date.now;
        Date.now = () => real() + ms;
      }, c.shiftMs);
    }
    const page = await ctx.newPage();
    const problems = [];
    watchPageErrors(page, problems, c.id);
    try {
      await page.goto(BASE + gamePath, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      // 何も描かれていないのに通る、を防ぐ。ボタンと最終更新の時刻が出ていること
      const shown = await page.evaluate(() => ({
        button: [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("情報を更新")),
        refreshed: document.body.innerText.includes("最終更新:"),
      }));
      rows.push({
        id: c.id,
        item: c.item,
        expected: "例外なし・「情報を更新」と最終更新の時刻が出ている",
        actual: `${problems.slice(0, 2).join(" / ") || "例外なし"} / ボタン=${shown.button} 最終更新=${shown.refreshed}（準備の更新=${prepared}）`,
        ok: problems.length === 0 && shown.button && shown.refreshed,
        note: "",
      });
    } catch (e) {
      rows.push({ id: c.id, item: c.item, expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    } finally {
      await ctx.close();
    }
  }
}

// ── 文字の大きさと濃さ（デザイン刷新の段階1） ──
// 以前は9〜11pxの文字が372か所あり、補助の文字は背景との明るさの差が 3.2:1 しかなかった。
// 決まり（tailwind.config.js）の値を変えただけなので、**決まりを通らない直書きが残っていると、その所だけ古いまま**になる。
// 主な画面で実際に描かれた文字を全部見て、12px未満と、背景との差が 4.5:1 未満のものを数える。
// 除くもの: 写真・グラデーションの上の文字（背景の色を測れない）、押せない状態（半透明）の部品、見えない文字。
// 管理画面（/admin）は刷新の対象外なので見ない
{
  const PAGES = ["/", `/groups/${ids.groupId}`, `/groups/${ids.groupId}?tab=albums`, `/groups/${ids.groupId}?tab=games`, `/groups/${ids.groupId}?tab=wishlist`, `/groups/${ids.groupId}/settings`, `/groups/${ids.groupId}/games/${ids.gameId}`, "/albums", `/albums/${ids.albumId}`, `/groups/${ids.groupId}/activity`, "/manual", "/upload", "/settings/profile", "/me"];
  const page = await context.newPage();
  const small = [];
  const low = [];
  let checked = 0;
  try {
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const parse = (c) => {
          const m = c && c.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
        };
        const blend = (top, bottom) => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });
        const lum = ({ r, g, b }) => {
          const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (x, y) => {
          const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
          return (a + 0.05) / (b + 0.05);
        };
        const out = { small: [], low: [], checked: 0 };
        for (const el of document.querySelectorAll("body *")) {
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          if (el.closest("[aria-hidden='true'], option, script, style, noscript")) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 3 || rect.height < 3) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility !== "visible" || cs.display === "none") continue;
          let opacity = 1;
          let overImage = false;
          const layers = [];
          let done = false;
          for (let n = el; n; n = n.parentElement) {
            const ns = getComputedStyle(n);
            opacity *= Number(ns.opacity);
            if (done) continue;
            if (ns.backgroundImage !== "none") overImage = true;
            const c = parse(ns.backgroundColor);
            if (c && c.a > 0) {
              layers.push(c);
              if (c.a >= 1) done = true;
            }
          }
          if (opacity < 1 || el.closest("button:disabled, [aria-disabled='true']")) continue;
          // 写真の上の文字（アルバムのカードなど）は、背景が img なので色を測れない
          const parentBox = el.closest("a, div, li, section");
          if (parentBox && parentBox.querySelector("img, video") && getComputedStyle(el).position !== "static") overImage = true;
          const text = el.textContent.trim().slice(0, 30);
          const size = parseFloat(cs.fontSize);
          out.checked++;
          if (size < 11.5) out.small.push(`${text}（${size}px）`);
          if (overImage) continue;
          let bg = { r: 255, g: 255, b: 255, a: 1 };
          for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
          let fg = parse(cs.color);
          if (!fg) continue;
          if (fg.a < 1) fg = blend(fg, bg);
          const bold = Number(cs.fontWeight) >= 700;
          const large = size >= 24 || (bold && size >= 18.66);
          const cr = ratio(fg, bg);
          if (cr < (large ? 3 : 4.5)) out.low.push(`${text}（${cr.toFixed(2)}:1）`);
        }
        return out;
      });
      checked += r.checked;
      small.push(...r.small.map((x) => `${path} ${x}`));
      low.push(...r.low.map((x) => `${path} ${x}`));
    }
    rows.push({
      id: "B123",
      item: "主な画面に12px未満の文字が無い（管理画面は除く）",
      expected: "0件",
      actual: `${small.length}件 / 見た文字 ${checked}か所`,
      ok: checked > 100 && small.length === 0,
      note: small.slice(0, 4).join(" | ").slice(0, 200),
    });
    rows.push({
      id: "B124",
      item: "主な画面の文字が背景との明るさの差 4.5:1 以上ある（大きい文字は3:1。写真の上と押せない部品は除く）",
      expected: "0件",
      actual: `${low.length}件 / 見た文字 ${checked}か所`,
      ok: checked > 100 && low.length === 0,
      note: low.slice(0, 4).join(" | ").slice(0, 200),
    });
  } catch (e) {
    for (const id of ["B123", "B124"]) {
      rows.push({ id, item: "文字の大きさと濃さ", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    await page.close();
  }
}

// ── 等幅フォントと絵文字（デザイン刷新の段階2） ──
// 以前は font-mono を日本語の文にまで使っていて（572か所）、活動の記録は絵文字（📷📁💡🎮）をそのまま出していた。
// 等幅は数字が並ぶ所（font-num）だけ、種類の印は線のアイコン（ActivityIcon）に揃えた。
// 実際に描かれた文字で、「日本語の文が等幅で描かれている所」と「本文に出ている絵文字」を数える。
// 使い方の説明ページは文章の中で絵文字に触れるので、絵文字の数からは外す（等幅は見る）
{
  const PAGES = ["/", `/groups/${ids.groupId}`, `/groups/${ids.groupId}?tab=albums`, `/groups/${ids.groupId}?tab=games`, `/groups/${ids.groupId}?tab=wishlist`, `/groups/${ids.groupId}/settings`, `/groups/${ids.groupId}/games/${ids.gameId}`, "/albums", `/albums/${ids.albumId}`, `/groups/${ids.groupId}/activity`, "/manual", "/upload", "/settings/profile", "/me"];
  const page = await context.newPage();
  const monoJa = [];
  const emoji = [];
  let checked = 0;
  try {
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const r = await page.evaluate((skipEmoji) => {
        const ja = /[\u3040-\u30ff\u4e00-\u9fff]/g;
        const em = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
        const out = { monoJa: [], emoji: [], checked: 0 };
        for (const el of document.querySelectorAll("body *")) {
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
          if (!own) continue;
          if (el.closest("script, style, noscript, option")) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 3 || rect.height < 3) continue;
          out.checked++;
          const jaCount = (own.match(ja) ?? []).length;
          const family = getComputedStyle(el).fontFamily;
          if (jaCount >= 4 && jaCount / own.length > 0.5 && /^"?JetBrains Mono/.test(family)) out.monoJa.push(own.slice(0, 24));
          if (!skipEmoji && em.test(own)) out.emoji.push(own.slice(0, 24));
        }
        return out;
      }, path === "/manual");
      checked += r.checked;
      monoJa.push(...r.monoJa.map((x) => `${path} ${x}`));
      emoji.push(...r.emoji.map((x) => `${path} ${x}`));
    }
    rows.push({
      id: "B125",
      item: "主な画面で、日本語の文が等幅フォントで描かれておらず、本文に絵文字が出ていない（使い方の説明ページの絵文字は除く）",
      expected: "等幅の日本語 0件・絵文字 0件",
      actual: `等幅の日本語 ${monoJa.length}件・絵文字 ${emoji.length}件 / 見た文字 ${checked}か所`,
      ok: checked > 100 && monoJa.length === 0 && emoji.length === 0,
      note: [...monoJa, ...emoji].slice(0, 4).join(" | ").slice(0, 200),
    });
  } catch (e) {
    rows.push({ id: "B125", item: "等幅フォントと絵文字", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// ── 言葉の整理（デザイン刷新の段階3） ──
// 「気になる」が3つの別のものに使われていた: ゲームの状態（WISHLIST）、自分が狙っている印、提案へのリアクション。
// それぞれ「プレイ予定」「ねらってる」「様子見」に分けた（提案の「興味なし」も「パス」に）。
// 画面の文字だけでなく title と aria-label も見る（グループ画面の提案カードはリアクションの名前を title にだけ持っている）。
// **提案は自分で作る。** seed の提案は前のスイートで採用済みになっていて、リアクションの欄が出ない（通しで1回落ちた）。
// 活動の記録は補足にDBの値をそのまま出していた（「WISHLIST → PLAYING」「LIKE」「👍 2」）ので、英字の値も古い呼び方として数える。
// 「様子見」で投票しておくと、活動の画面に投票の記録が必ず1件並ぶ
{
  const OLD = /気になる|気になって|興味なし|\b(WISHLIST|PLAYING|BACKLOG|COMPLETED|LIKE|MAYBE|PASS)\b/;
  const NEW = ["プレイ予定", "ねらってる", "様子見", "パス"];
  const page = await context.newPage();
  const old = [];
  let all = "";
  let proposalId = null;
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "domcontentloaded" });
    proposalId = await page.evaluate(async (gid) => {
      const res = await fetch(`/api/groups/${gid}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steamAppId: 7700126, title: "言葉の整理テスト" }),
      });
      const id = (await res.json().catch(() => null))?.proposal?.id ?? null;
      if (id) {
        await fetch(`/api/groups/${gid}/proposals/${id}/reactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "MAYBE" }),
        });
      }
      return id;
    }, ids.groupId);
    if (!proposalId) throw new Error("提案を作れなかった");
    // グループ画面はスマホでは区画がタブに分かれ、隠れた区画の文字は innerText に入らないので、タブごとに開く
    const PAGES = [`/groups/${ids.groupId}`, `/groups/${ids.groupId}?tab=games`, `/groups/${ids.groupId}?tab=wishlist`, `/groups/${ids.groupId}/games/${ids.gameId}`, `/groups/${ids.groupId}/proposals/${proposalId}`, `/groups/${ids.groupId}/activity`];
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const text = await page.evaluate(() =>
        [
          document.body.innerText,
          ...[...document.querySelectorAll("[title], [aria-label]")].map((el) => `${el.getAttribute("title") ?? ""} ${el.getAttribute("aria-label") ?? ""}`),
        ].join("\n")
      );
      for (const line of text.split("\n")) if (OLD.test(line)) old.push(`${path} ${line.trim().slice(0, 30)}`);
      all += text;
    }
    const missing = NEW.filter((w) => !all.includes(w));
    rows.push({
      id: "B126",
      item: "グループ・ゲーム詳細・提案・活動の画面に古い呼び方（気になる・興味なし・DBの英字の値）が無く、新しい呼び方（プレイ予定・ねらってる・様子見・パス）が出ている",
      expected: "古い呼び方 0件・新しい呼び方 4つとも出ている",
      actual: `古い呼び方 ${old.length}件・出ていない新しい呼び方 ${missing.join("、") || "なし"}`,
      ok: old.length === 0 && missing.length === 0,
      note: old.slice(0, 4).join(" | ").slice(0, 200),
    });
  } catch (e) {
    rows.push({ id: "B126", item: "言葉の整理", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    // 作った提案は同じ経路（API）で取り下げる。DB直で消すとキャッシュに残る
    if (proposalId) {
      await page
        .evaluate(([gid, pid]) => fetch(`/api/groups/${gid}/proposals/${pid}`, { method: "DELETE" }), [ids.groupId, proposalId])
        .catch(() => {});
    }
    await page.close();
  }
}

// ── ゲームカードの部品がカードからはみ出さない（デザイン刷新の段階3） ──
// 「ねらってる」のボタンに文字を足したら、スマホの2列のカードで右端が切れ、削除ボタンが見えなくなった。
// カードは overflow-hidden なのでページの横スクロール（B91）には出ない。カードの箱と中の部品の箱を比べる
{
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/groups/${ids.groupId}?tab=games`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const out = { cards: 0, parts: 0, over: [] };
      for (const card of document.querySelectorAll('[data-testid="game-card"]')) {
        out.cards++;
        const c = card.getBoundingClientRect();
        for (const el of card.querySelectorAll("button, select")) {
          out.parts++;
          const b = el.getBoundingClientRect();
          if (b.right > c.right + 0.5 || b.left < c.left - 0.5) {
            out.over.push(`${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 12)}（${Math.round(b.right - c.right)}px）`);
          }
        }
      }
      return out;
    });
    rows.push({
      id: "B127",
      item: "スマホ幅のグループ画面で、ゲームカードのボタンと選択欄がカードの外にはみ出していない",
      expected: "はみ出し 0件",
      actual: `はみ出し ${r.over.length}件 / カード ${r.cards}枚・部品 ${r.parts}個`,
      ok: r.cards > 0 && r.parts > r.cards && r.over.length === 0,
      note: r.over.slice(0, 4).join(" | ").slice(0, 200),
    });
  } catch (e) {
    rows.push({ id: "B127", item: "ゲームカードのはみ出し", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

// ── グループ画面の作り（デザイン刷新の段階5） ──
// スマホは「ようす・アルバム・ゲーム・ウィッシュ」のタブ（URL の ?tab= に持たせる）、PC（1280px以上）は2列。
// 見出しに「写真を投稿」「メンバー」「歯車（グループの設定）」。ボタンの高さはスマホ44px・PC36px。
// 提案のカードの部品も測るので、未採用の提案を1件作り、最後に同じ経路（API）で取り下げる
{
  const EXPECTED = {
    B133: "スマホ幅でタブ4つ（ようす・アルバム・ゲーム・ウィッシュ）が出て、押すとその区画だけが見え、URLに ?tab= が付く",
    B134: "戻るボタンで前のタブに戻り、?tab= 付きのURLを直接開くとサーバーのHTMLの時点でそのタブになっている（画面の食い違いが出ない）",
    B135: "グループ画面のボタンと選択欄が、スマホ幅で44px以上・PC幅で36px以上ある（4つのタブすべて・提案のカードも含む）",
    B136: "PC幅（1440px）では2列（左にアルバムとゲーム、右にようすとウィッシュリスト）、1024pxでは1列で「ようす」が一番上",
    B137: "見出しの「写真を投稿」はこのグループを選んだ状態で投稿画面を開き、歯車はグループの設定（通知・最少人数・削除）を開く",
    B138: "メンバー（オーナーでも管理者でもない人）にはグループ画面に歯車が出ず、設定画面も開けない",
  };
  const recorded = new Set();
  const localRows = [];
  const rec = (id, expected, actual, ok, note = "") => {
    recorded.add(id);
    localRows.push({ id, item: EXPECTED[id], expected, actual, ok, note });
  };
  const tokenFor = async (who) =>
    encode({ token: { name: who, email: `${who}@example.com`, sub: `${who}@example.com` }, secret: SECRET, maxAge: 3600 });
  const newCtx = async (width, height, who = "admin") => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addCookies([{ name: "next-auth.session-token", value: await tokenFor(who), domain: "127.0.0.1", path: "/", httpOnly: true }]);
    return ctx;
  };
  const GROUP = `${BASE}/groups/${ids.groupId}`;
  // 見えている区画（display: none でないもの）
  const visibleTabs = (p) =>
    p.evaluate(() => [...document.querySelectorAll("section[data-tab]")].filter((s) => s.getBoundingClientRect().height > 0).map((s) => s.dataset.tab));
  // 高さの足りないボタン・選択欄
  const shortControls = (p, min) =>
    p.evaluate((m) =>
      [...document.querySelectorAll("main button, main select")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < m - 0.5;
        })
        .map((el) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 14)}（${Math.round(el.getBoundingClientRect().height)}px）`),
    min);

  const phone = await newCtx(390, 844);
  const page = await phone.newPage();
  const hydration = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /#418|#422|#423|#425|hydrat/i.test(m.text())) hydration.push(m.text().slice(0, 120));
  });
  let proposalId = null;
  try {
    await page.goto(GROUP, { waitUntil: "networkidle" });
    proposalId = await page.evaluate(async (gid) => {
      const res = await fetch(`/api/groups/${gid}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steamAppId: 7700135, title: "高さ確認の提案" }),
      });
      return (await res.json().catch(() => null))?.proposal?.id ?? null;
    }, ids.groupId);
    await page.reload({ waitUntil: "networkidle" });

    // B133: タブ
    const tabLabels = (await page.getByRole("tab").allInnerTexts()).map((t) => t.trim());
    const initial = await visibleTabs(page);
    await page.getByRole("tab", { name: "ゲーム" }).click();
    await page.waitForTimeout(300);
    const afterGames = await visibleTabs(page);
    const urlGames = new URL(page.url()).search;
    rec(
      "B133",
      "ようす・アルバム・ゲーム・ウィッシュ / 最初は overview だけ / ゲームを押すと games だけ・?tab=games",
      `${tabLabels.join("・")} / 最初=${initial.join(",")} / 押した後=${afterGames.join(",")}・${urlGames}`,
      JSON.stringify(tabLabels) === JSON.stringify(["ようす", "アルバム", "ゲーム", "ウィッシュ"]) &&
        JSON.stringify(initial) === JSON.stringify(["overview"]) &&
        JSON.stringify(afterGames) === JSON.stringify(["games"]) &&
        urlGames === "?tab=games"
    );

    // B134: 戻る・直接開く
    await page.getByRole("tab", { name: "ウィッシュ" }).click();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForTimeout(500);
    const afterBack = await visibleTabs(page);
    const backUrl = new URL(page.url()).search;
    const html = await (await phone.request.get(`${GROUP}?tab=albums`)).text();
    // サーバーのHTMLで、アルバムの区画だけが隠されていない（クラスに "hidden" が無い）こと
    const ssr = [...html.matchAll(/<section[^>]*data-tab="(\w+)"[^>]*class="([^"]*)"/g)].map(([, tab, cls]) => [tab, !/(^|\s)hidden(\s|$)/.test(cls)]);
    const ssrShown = ssr.filter(([, shown]) => shown).map(([tab]) => tab);
    hydration.length = 0;
    await page.goto(`${GROUP}?tab=albums`, { waitUntil: "networkidle" });
    const direct = await visibleTabs(page);
    rec(
      "B134",
      "戻ると games・?tab=games / HTMLで albums だけ見える / 開いても albums だけ / 食い違い0件",
      `戻った後=${afterBack.join(",")}・${backUrl} / HTML=${ssrShown.join(",") || "なし"} / 開いた後=${direct.join(",")} / 食い違い${hydration.length}件`,
      JSON.stringify(afterBack) === JSON.stringify(["games"]) && backUrl === "?tab=games" &&
        JSON.stringify(ssrShown) === JSON.stringify(["albums"]) && JSON.stringify(direct) === JSON.stringify(["albums"]) &&
        hydration.length === 0,
      hydration.slice(0, 2).join(" | ")
    );

    // B135: 高さ（スマホは4つのタブ、PCは全体）
    const shortPhone = [];
    for (const t of ["", "albums", "games", "wishlist"]) {
      await page.goto(`${GROUP}${t ? `?tab=${t}` : ""}`, { waitUntil: "networkidle" });
      shortPhone.push(...(await shortControls(page, 44)).map((x) => `${t || "overview"}:${x}`));
    }
    const pc = await newCtx(1440, 900);
    const pcPage = await pc.newPage();
    let shortPc = [];
    let layout = { wide: null, narrow: null };
    try {
      await pcPage.goto(GROUP, { waitUntil: "networkidle" });
      shortPc = await shortControls(pcPage, 36);
      const cardControls = await pcPage.locator('section[data-tab="wishlist"] button, section[data-tab="wishlist"] select').count();
      rec(
        "B135",
        "足りない部品 0件（提案のカードの部品も測っている）",
        `スマホ ${shortPhone.length}件 / PC ${shortPc.length}件 / ウィッシュリストの部品 ${cardControls}個`,
        shortPhone.length === 0 && shortPc.length === 0 && cardControls >= 5,
        [...shortPhone, ...shortPc].slice(0, 5).join(" | ").slice(0, 200)
      );

      // B136: 2列と1列。区画の箱の位置で見る
      const boxes = () =>
        pcPage.evaluate(() =>
          Object.fromEntries(
            [...document.querySelectorAll("section[data-tab]")].map((s) => {
              const r = s.getBoundingClientRect();
              return [s.dataset.tab, { x: Math.round(r.x), y: Math.round(r.y + window.scrollY) }];
            })
          )
        );
      const w = await boxes();
      const wideOk =
        w.albums.x === w.games.x && w.overview.x === w.wishlist.x && w.overview.x > w.albums.x + 300 &&
        w.albums.y < w.games.y && w.overview.y < w.wishlist.y;
      await pcPage.setViewportSize({ width: 1024, height: 900 });
      await pcPage.waitForTimeout(400);
      const n = await boxes();
      const order = Object.entries(n).sort((a, b) => a[1].y - b[1].y).map(([k]) => k);
      const narrowOk = new Set(Object.values(n).map((b) => b.x)).size === 1 && JSON.stringify(order) === JSON.stringify(["overview", "albums", "games", "wishlist"]);
      layout = { wideOk, narrowOk, order };
      rec(
        "B136",
        "1440px: 左に albums→games、右に overview→wishlist / 1024px: 1列で overview→albums→games→wishlist",
        `1440px=${wideOk ? "2列" : JSON.stringify(w)} / 1024px=${order.join("→")}（${narrowOk ? "1列" : "崩れている"}）`,
        wideOk && narrowOk
      );

      // B137: 写真を投稿と歯車
      await pcPage.setViewportSize({ width: 1440, height: 900 });
      await pcPage.goto(GROUP, { waitUntil: "networkidle" });
      await pcPage.locator("main").getByRole("link", { name: "写真を投稿" }).click();
      await pcPage.waitForURL("**/upload?group=**", { timeout: 15000 });
      await pcPage.waitForTimeout(1200);
      const selectedGroup = await pcPage.locator(`select:has(option[value="${ids.groupId}"])`).inputValue().catch(() => "");
      await pcPage.goto(GROUP, { waitUntil: "networkidle" });
      await pcPage.getByRole("link", { name: "グループの設定" }).click();
      await pcPage.waitForURL("**/settings", { timeout: 15000 });
      // 遷移の直後は読み込み中の骨格が出ている。設定画面の見出しが出るまで待ってから読む（待たずに読んで空だった）
      await pcPage.getByRole("heading", { name: "グループの設定" }).waitFor({ timeout: 15000 });
      const settingsText = await pcPage.locator("main").innerText();
      const hasAll = ["Discordへの通知", "プレイ記録", "グループの削除"].every((t) => settingsText.includes(t));
      rec(
        "B137",
        "投稿画面でこのグループが選ばれている / 設定画面に通知・プレイ記録・削除",
        `選ばれているグループ=${selectedGroup === ids.groupId ? "このグループ" : selectedGroup || "なし"} / 設定画面=${hasAll ? "3つともある" : settingsText.slice(0, 60)}`,
        selectedGroup === ids.groupId && hasAll
      );
    } finally {
      await pc.close();
    }

    // B138: メンバーには歯車も設定画面も無い
    const member = await newCtx(390, 844, "member");
    try {
      const mp = await member.newPage();
      await mp.goto(GROUP, { waitUntil: "networkidle" });
      const gear = await mp.getByRole("link", { name: "グループの設定" }).count();
      await mp.goto(`${GROUP}/settings`, { waitUntil: "networkidle" });
      const body = await mp.locator("body").innerText();
      const blocked = !body.includes("Discordへの通知") && !body.includes("グループの削除");
      rec("B138", "歯車0個 / 設定画面の中身が出ない", `歯車${gear}個 / 設定画面=${blocked ? "出ない" : "出ている"}`, gear === 0 && blocked);
    } finally {
      await member.close();
    }
  } catch (e) {
    for (const [id, item] of Object.entries(EXPECTED)) {
      if (recorded.has(id)) continue;
      localRows.push({ id, item, expected: "—", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
    }
  } finally {
    if (proposalId) {
      await page.evaluate(([gid, pid]) => fetch(`/api/groups/${gid}/proposals/${pid}`, { method: "DELETE" }), [ids.groupId, proposalId]).catch(() => {});
    }
    localRows.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    rows.push(...localRows);
    await phone.close();
  }
}

// ── グループ画面以外のボタンの高さ（デザイン刷新の段階6） ──
// 段階5でグループ画面に入れた決まり（スマホ44px・PC36px）を他の画面にも広げた。画面を足したらここの一覧にも足す。
// 提案の詳細はリアクションの欄が出るよう提案を自分で作り、写真を開いた表示（ライトボックス）は main の外なので別に開いて測る
{
  const PAGES = [
    "/",
    "/albums",
    `/albums/${ids.albumId}`,
    `/groups/${ids.groupId}/games/${ids.gameId}`,
    "{proposal}",
    "/groups",
  ];
  const short = [];
  let proposalId = null;
  let measured = 0;
  const tokenValue = await encode({ token: { name: "admin", email: "admin@example.com", sub: "admin@example.com" }, secret: SECRET, maxAge: 3600 });
  const measure = (p, min, scope) =>
    p.evaluate(([m, sel]) => {
      const root = document.querySelector(sel) ?? document.body;
      const els = [...root.querySelectorAll("button, select, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      return {
        count: els.length,
        bad: els
          .filter((el) => el.getBoundingClientRect().height < m - 0.5)
          .map((el) => `${(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || el.tagName).trim().slice(0, 14)}（${Math.round(el.getBoundingClientRect().height)}px）`),
      };
    }, [min, scope]);
  try {
    for (const [w, h, min] of [[390, 844, 44], [1280, 800, 36]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addCookies([{ name: "next-auth.session-token", value: tokenValue, domain: "127.0.0.1", path: "/", httpOnly: true }]);
      const p = await ctx.newPage();
      try {
        if (!proposalId) {
          await p.goto(`${BASE}/groups/${ids.groupId}`, { waitUntil: "domcontentloaded" });
          proposalId = await p.evaluate(async (gid) => {
            const res = await fetch(`/api/groups/${gid}/proposals`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ steamAppId: 7700139, title: "高さ確認（段階6）" }),
            });
            return (await res.json().catch(() => null))?.proposal?.id ?? null;
          }, ids.groupId);
        }
        for (const raw of PAGES) {
          const path = raw === "{proposal}" ? `/groups/${ids.groupId}/proposals/${proposalId}` : raw;
          await p.goto(BASE + path, { waitUntil: "networkidle" });
          const r = await measure(p, min, "main");
          measured += r.count;
          short.push(...r.bad.map((x) => `${w}px ${path.replace(/[a-z0-9]{20,}/g, "…")} ${x}`));
        }
        // 写真を開いた表示（ライトボックス）
        await p.goto(`${BASE}/albums/${ids.albumId}`, { waitUntil: "networkidle" });
        // ライトボックスは role を持たないので、ほかのテスト（B36 など）と同じく写真の枠を押して開き、重ねた箱の中を測る
        await p.locator("main div.aspect-square").first().click();
        await p.locator("div.fixed.inset-0.z-50").first().waitFor({ timeout: 10000 });
        await p.waitForTimeout(400);
        const lb = await measure(p, min, "div.fixed.inset-0.z-50");
        measured += lb.count;
        short.push(...lb.bad.map((x) => `${w}px 写真を開いたところ ${x}`));
      } finally {
        await ctx.close();
      }
    }
    rows.push({
      id: "B139",
      item: "ホーム・アルバム（一覧・詳細・写真を開いたところ）・ゲーム詳細・提案詳細・グループ一覧のボタンと入力欄が、スマホ幅で44px以上・PC幅で36px以上ある",
      expected: "足りない部品 0件",
      actual: `${short.length}件 / 測った部品 ${measured}個`,
      ok: short.length === 0 && measured > 40,
      note: short.slice(0, 5).join(" | ").slice(0, 200),
    });
  } catch (e) {
    rows.push({ id: "B139", item: "グループ画面以外のボタンの高さ", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    if (proposalId) {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "next-auth.session-token", value: tokenValue, domain: "127.0.0.1", path: "/", httpOnly: true }]);
      await ctx.request.delete(`${BASE}/api/groups/${ids.groupId}/proposals/${proposalId}`).catch(() => {});
      await ctx.close();
    }
  }
}

// ── スマホ幅で、部品が画面の右へはみ出していない（デザイン刷新の段階6） ──
// ボタンを44pxの丸にしたら、アルバム詳細の見出しのボタン4つが1行に収まらず「削除」が画面の外に切れた。
// ページ全体の横スクロール（B91）には出ない——レイアウトの内側の箱が横のはみ出しを抑えているため。
// main の中の要素の右端が画面の幅を超えていないかを見る。横に送る作りの箱（overflow-x が auto など）の中は、意図したものなので除く
{
  const PAGES = ["/", "/albums", `/albums/${ids.albumId}`, `/groups/${ids.groupId}`, `/groups/${ids.groupId}?tab=albums`, `/groups/${ids.groupId}?tab=games`, `/groups/${ids.groupId}?tab=wishlist`, `/groups/${ids.groupId}/settings`, `/groups/${ids.groupId}/games/${ids.gameId}`, "/groups", "/me"];
  const page = await context.newPage();
  const over = [];
  try {
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      const r = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return [];
        const vw = document.documentElement.clientWidth;
        const out = [];
        for (const el of main.querySelectorAll("*")) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.right <= vw + 1) continue;
          let scrolled = false;
          for (let n = el.parentElement; n && n !== main.parentElement; n = n.parentElement) {
            if (["auto", "scroll", "hidden"].includes(getComputedStyle(n).overflowX)) {
              scrolled = true;
              break;
            }
          }
          if (!scrolled) out.push(`${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 12)}（+${Math.round(rect.right - vw)}px）`);
        }
        return out;
      });
      over.push(...r.slice(0, 3).map((x) => `${path.replace(/[a-z0-9]{20,}/g, "…")} ${x}`));
    }
    rows.push({
      id: "B140",
      item: "スマホ幅の主な画面で、部品が画面の右へはみ出していない（横に送る作りの箱の中は除く）",
      expected: "0件",
      actual: `${over.length}件 / 見た画面 ${PAGES.length}`,
      ok: over.length === 0,
      note: over.slice(0, 4).join(" | ").slice(0, 200),
    });
  } catch (e) {
    rows.push({ id: "B140", item: "スマホ幅のはみ出し", expected: "-", actual: "未確認", ok: false, note: `途中で中断: ${String(e.message ?? e).slice(0, 80)}` });
  } finally {
    await page.close();
  }
}

await browser.close();
// **スタックは表に入らないので別ファイルに残す。** 間欠的に出る例外は、
// 次に出たときの材料が無いと追えない（`_pageerrors.mjs` のコメント参照）
writePageErrors("browser");
const summary = writeResults("browser", "B: 実ブラウザでの描画", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
