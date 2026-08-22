// 活動ログ（ActivityLog）の記録漏れを静的に洗い出す。
//
// 週次まとめとタイムライン／カレンダーはこのログを読む（docs/activity-log.md）。
// 記録は書き込みハンドラから手で呼ぶ形にしたので、**放っておくと必ずどこかで忘れる**。
// このリポジトリはキャッシュ無効化の呼び忘れで一度やらかしていて、その対策が
// audit-invalidation.mjs だった。同じ手をログにも掛ける。
//
// 見るのは2つ。
//   - 記録すべき対象を書き換えているのに logActivity を呼んでいない
//     → その出来事だけが週次まとめとカレンダーから永久に消える
//   - GET なのに呼んでいる
//     → 読んだだけで「出来事」が増える（数字が壊れる）
//
// 使い方: node tools/local-test/audit-activity-log.mjs
import { readFileSync, globSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const API_DIR = join(ROOT, "apps/web/src/app/api");

const files = globSync("**/route.ts", { cwd: API_DIR }).sort();

// **記録の対象になるモデルへの書き込みだけを見る。**
// 全ての書き込みを対象にすると、設定値・ハートビート・APIの使用量まで
// 「呼び忘れ」として並び、本当の漏れが埋もれる（＝この道具の意味が消える）。
const TRACKED_WRITE =
  /\bdb\.(photo|album|groupGame|groupGameInterest|groupGameProposal|groupGameProposalReaction|photoReaction|groupMember)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;

// **import文で判定する。素の文字列一致で見てはいけない。**
// 「なぜ記録しないか」を説明したコメントに含まれる logActivity という単語に反応して、
// 記録不要のルートまで落ちる（cacheTags で実際に踏んだ形）。
const IMPORTS_ACTIVITY = /from\s+["']@\/lib\/activityLog["']/;
const HELPER_CALL = /\b(logActivity|activityLogCreateArgs)\s*\(/;
// **db.activityLog を直に触る経路も「記録あり」に数える。**
// 最初これを import と AND で見ていたため、ヘルパを使わず updateMany で
// groupId を埋め直しているルート（photos/assign-album）が「呼び忘れ」として落ちた。
// ドットの前後で改行されうる（prettier が `db.activityLog\n  .updateMany(` に折る）ので、
// 空白をまたげる形にしておく。整形のされ方でチェックの効き目が変わってはいけない。
const DIRECT_CALL = /\bdb\s*\.\s*activityLog\s*\.\s*\w+\s*\(/;

const HANDLER =
  /export async function (GET|POST|PATCH|DELETE|PUT)\([\s\S]*?(?=\nexport async function |$)/g;

// 「意図的に記録しない」と宣言するための印。
// 黙って対象外にすると、本当の呼び忘れと区別がつかなくなる。
const INTENTIONAL = /audit-activity-log:\s*(?:意図的に)?記録しない\s*[（(]?([^\n)）]*)/;

const rows = [];
const problems = [];

for (const rel of files) {
  const source = readFileSync(join(API_DIR, rel), "utf8");
  const intentional = source.match(INTENTIONAL);

  for (const m of source.matchAll(HANDLER)) {
    const [body, method] = [m[0], m[1]];
    const writes = [...new Set([...body.matchAll(TRACKED_WRITE)].map((w) => `${w[1]}.${w[2]}`))];
    const logs =
      (IMPORTS_ACTIVITY.test(source) && HELPER_CALL.test(body)) || DIRECT_CALL.test(body);

    if (writes.length === 0 && !logs) continue;

    let issue = "";
    if (method === "GET" && logs) {
      issue = "GETなのに記録している（読んだだけで出来事が増える）";
    } else if (method !== "GET" && writes.length > 0 && !logs && !intentional) {
      issue = "記録対象を書き換えているのに logActivity を呼んでいない";
    }

    rows.push({
      ルート: rel,
      メソッド: method,
      書き込み: writes.join(",") || "-",
      記録: logs ? "あり" : intentional ? `意図的に記録しない（${intentional[1].trim()}）` : "-",
      問題: issue,
    });
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
