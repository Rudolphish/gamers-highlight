// 各スイートが結果を書き出すための共通処理。
// build-report.mjs がこれらを読んで docs/test-results.md を組み立てる。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = join(HERE, "results");

/**
 * @param {string} suite  スイート名（ファイル名になる）
 * @param {string} title  レポートに出す見出し
 * @param {{id:string, item:string, expected?:string, actual?:string, ok:boolean, note?:string}[]} rows
 */
export function writeResults(suite, title, rows) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const payload = {
    suite,
    title,
    ranAt: new Date().toISOString(),
    total: rows.length,
    failed: rows.filter((r) => !r.ok).length,
    rows,
  };
  writeFileSync(join(RESULTS_DIR, `${suite}.json`), JSON.stringify(payload, null, 2));
  const ng = payload.failed;
  console.log(`\n[${suite}] ${payload.total} 件 / NG ${ng} 件 → results/${suite}.json`);
  return payload;
}
