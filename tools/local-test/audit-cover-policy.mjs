// アルバムのカバー候補を引くクエリが、方針（lib/albumCoverPolicy.ts）を通っているかを静的に見る。
//
// **なぜ要るか**: 「アルバムに紐づく写真を新しい順に1件だけ引く」という同じ形が、
// 画面（`lib/groupData.ts`・`/albums`）とAPI（`/api/groups/:id`）の3箇所にあった。
// YouTubeをカバーから外す方針を1箇所に集約したとき、**画面2箇所だけを直して
// APIを見落とした**（後追いレビューで指摘されて気づいた）。
// 目で探すと「自分が今開いているファイル」しか見つけられない。
//
// 見落としたままだと、新しい種類（YOUTUBE）が黙ってカバーに混ざる。しかも
// そのAPIを誰も使っていない間は誰も気づかない。
//
// **例外は宣言する。** 「最後に投稿があった日時」を知りたいだけの箇所もあり、
// そこはYouTubeも数えたい（＝方針とは別物）。黙って対象外にすると本当の見落としと
// 区別がつかなくなるので、印を書いて表に残す。
//
// 使い方: node tools/local-test/audit-cover-policy.mjs
import { readFileSync, globSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "apps/web/src");

// `photos: { ... take: 1 ... }` の形（アルバムに紐づく写真を1件だけ引いている）。
//
// **正規表現で `{...}` を拾ってはいけない。** 最初 `/photos:\s*\{[^}]*take:\s*1[^}]*\}/`
// と書いたが、中に `orderBy: { ... }` が入ると `[^}]*` がそこで止まって当たらない。
// 実際に `/api/internal/group-games` の `select` 付きの書き方を1件取りこぼしていた——
// **見落としを見つけるための道具が、同じ形の見落としをしていた。**
// 括弧の対応を数えて中身を取り出す。
function photoBlocks(source) {
  const blocks = [];
  const re = /photos:\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, i + 1));
  }
  return blocks;
}
// 方針を通している呼び出し
const USES_POLICY = /photos:\s*coverPhotoQuery/;
// 「カバー候補ではない」と宣言する印
const INTENTIONAL = /audit-cover-policy:\s*(?:意図的に)?方針を使わない\s*[（(]?([^\n)）]*)/;

const files = globSync("**/*.{ts,tsx}", { cwd: SRC }).sort();
const rows = [];
const problems = [];

for (const rel of files) {
  const source = readFileSync(join(SRC, rel), "utf8");
  const raw = photoBlocks(source).filter((b) => /take:\s*1\b/.test(b));
  const usesPolicy = USES_POLICY.test(source);
  if (raw.length === 0 && !usesPolicy) continue;

  const intentional = source.match(INTENTIONAL);
  const issue =
    raw.length > 0 && !intentional
      ? "カバー候補を生のクエリで引いている（lib/albumCoverPolicy.ts の coverPhotoQuery を使う）"
      : "";

  rows.push({
    ファイル: rel,
    引き方: usesPolicy ? "方針を使用" : intentional ? `対象外（${intentional[1].trim()}）` : "生のクエリ",
    問題: issue,
  });
  if (issue) problems.push(`${rel}: ${issue}`);
}

console.table(rows);

if (problems.length > 0) {
  console.error(`\nNG ${problems.length} 件`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: ${rows.length} 箇所を確認、問題なし`);
}
