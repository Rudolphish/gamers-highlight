// キャッシュ無効化の呼び忘れ・呼びすぎを静的に洗い出す。
//
// 見るのは2つだけ。
//   - 書き込み（POST/PATCH/DELETE/PUT）なのに無効化を呼んでいない
//     → 「投稿したのに一覧に出ない」になり、時間では直らない
//   - GET なのに無効化を呼んでいる
//     → 読むたびにキャッシュを捨てるので、キャッシュを入れた意味が無くなる
//
// どちらも実際にやった。GETへの混入は「最初の return を書き換える」形の一括置換で起き、
// 目視では見落とした（自動レビューに指摘されて気づいた）。
//
// 使い方: node tools/local-test/audit-invalidation.mjs
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const API_DIR = join(ROOT, "apps/web/src/app/api");

const files = globSync("**/route.ts", { cwd: API_DIR }).sort();

const INVALIDATORS =
  /\b(invalidateAlbumWithGroup|invalidateAlbumPhotos|invalidateAlbum|invalidateGroup)\s*\(/;
const HANDLER = /export async function (GET|POST|PATCH|DELETE|PUT)\([\s\S]*?(?=\nexport async function |$)/g;

const rows = [];
const problems = [];

for (const rel of files) {
  const source = readFileSync(join(API_DIR, rel), "utf8");
  // キャッシュ対象に関係しないルートは対象外（無効化を呼ぶ必要が無い）
  if (!source.includes("cacheTags")) continue;

  for (const m of source.matchAll(HANDLER)) {
    const [body, method] = [m[0], m[1]];
    const calls = [...new Set([...body.matchAll(new RegExp(INVALIDATORS, "g"))].map((c) => c[1]))];

    let issue = "";
    if (method === "GET" && calls.length > 0) {
      issue = "GETなのに無効化を呼んでいる（読むたびにキャッシュを捨てる）";
    } else if (method !== "GET" && calls.length === 0) {
      issue = "書き込みなのに無効化を呼んでいない（変更が反映されない）";
    }

    rows.push({ ルート: rel, メソッド: method, 無効化: calls.join(",") || "-", 問題: issue });
    if (issue) problems.push(`${rel} ${method}: ${issue}`);
  }
}

console.table(rows);

if (problems.length > 0) {
  console.error(`\nNG ${problems.length} 件`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: ${rows.length} 個のハンドラを確認、問題なし`);
}
