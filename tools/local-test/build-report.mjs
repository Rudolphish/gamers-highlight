// results/*.json から docs/test-results.md を組み立てる。
// テスト項目表そのものはこの出力が正（スクリプトを直せば表も追随する）。
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR } from "./_results.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../docs/test-results.md");

// レポートに出す順番
const ORDER = ["pages", "api", "flows", "external-failure", "browser"];

if (!existsSync(RESULTS_DIR)) {
  console.error("results/ が無い。先に各スイートを実行すること（run-all.mjs）");
  process.exit(1);
}

const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
const suites = files
  .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")))
  .sort((a, b) => ORDER.indexOf(a.suite) - ORDER.indexOf(b.suite));

const totals = suites.reduce(
  (acc, s) => ({ total: acc.total + s.total, failed: acc.failed + s.failed }),
  { total: 0, failed: 0 }
);

const ranAt = suites.map((s) => s.ranAt).sort().at(-1) ?? new Date().toISOString();
const jstDate = new Date(ranAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

function esc(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const lines = [];
lines.push("# テスト項目と結果");
lines.push("");
lines.push("`tools/local-test/` の各スイートが出力した結果をそのまま表にしたもの。");
lines.push("**この表は手で書き換えない。** 項目を足すときはスクリプト側に足して、");
lines.push("`node tools/local-test/run-all.mjs` で作り直す（手順は");
lines.push("[`tools/local-test/README.md`](../tools/local-test/README.md)）。");
lines.push("");
lines.push(`最終実行: **${jstDate}**（JST） / 合計 **${totals.total}** 件 / NG **${totals.failed}** 件`);
lines.push("");
lines.push("| スイート | 内容 | 件数 | NG |");
lines.push("|---|---|---:|---:|");
for (const s of suites) {
  lines.push(`| ${s.suite} | ${esc(s.title)} | ${s.total} | ${s.failed} |`);
}
lines.push("");
lines.push("外部サービスはすべてスタブなので、**先方の仕様変更で壊れる類の不具合はここには出ない**。");
lines.push("実機でしか確認できないことは `docs/handoff.md` の「実機でしか確認できていないこと」にある。");
lines.push("");

for (const s of suites) {
  lines.push("---");
  lines.push("");
  lines.push(`## ${esc(s.title)}`);
  lines.push("");
  lines.push(`${s.total} 件 / NG ${s.failed} 件`);
  lines.push("");
  lines.push("| ID | 項目 | 期待 | 実際 | 結果 | 備考 |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of s.rows) {
    lines.push(
      `| ${esc(r.id)} | ${esc(r.item)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.ok ? "OK" : "**NG**"} | ${esc(r.note)} |`
    );
  }
  lines.push("");
}

writeFileSync(OUT, lines.join("\n"));
console.log(`docs/test-results.md を書き出した（${totals.total} 件 / NG ${totals.failed} 件）`);
