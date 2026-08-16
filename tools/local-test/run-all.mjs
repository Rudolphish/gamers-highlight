// 全スイートをまとめて流し、docs/test-results.md を作り直す。
//
// 前提（README参照）:
//   - ローカルPostgresが起動していて DATABASE_URL が通っている
//   - 模擬R2（mock-r2.mjs）が 9100 で起動している
//   - 本番ビルドのアプリが fetch-stub.cjs 付きで 3000 で起動している
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(script, env = {}) {
  console.log(`\n────── ${script} ──────`);
  try {
    execFileSync(node, [join(HERE, script)], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return true;
  } catch {
    // 各スイートはNGがあると非0で終わる。ここでは止めず、最後にまとめて報告する
    return false;
  }
}

// 1) テストデータを入れ直す（外部キャッシュも消すので毎回同じ状態から始まる）
run("seed.mjs");

// 2) IDを取り出して各スイートへ渡す
const SEED_IDS = execFileSync(node, [join(HERE, "ids.mjs")], { encoding: "utf8" }).trim();
const env = { SEED_IDS };

// 3) 各スイート。順番に意味がある：
//    flows は写真の削除などでデータを動かすので、ページ/APIの確認より後に流す
const outcomes = {
  pages: run("sweep.mjs", env),
  api: run("api-sweep.mjs", env),
  flows: run("flows.mjs", env),
  "external-failure": run("external-failure.mjs", env),
  browser: run("browser.mjs", env),
};

// 4) 表を作り直す
run("build-report.mjs");

const failed = Object.entries(outcomes).filter(([, ok]) => !ok);
console.log("\n══════ まとめ ══════");
for (const [name, ok] of Object.entries(outcomes)) {
  console.log(`  ${ok ? "OK" : "NG"}  ${name}`);
}
if (failed.length > 0) {
  console.log("\nNGの詳細は docs/test-results.md を見る");
  process.exitCode = 1;
}
