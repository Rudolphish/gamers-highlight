// ブラウザで起きた例外を、表に出す短い1行とは別に**スタックごと**書き出す。
//
// **間欠的に出る例外は、次に出たときの材料が残っていないと追えない。**
// 実際に B08（提案詳細）が通しの2回目で一度だけ `Minified React error #310`
// （「Rendered more hooks than during the previous render」）で落ちたが、
// 表に残っていたのは140文字に切った本文だけで、どの部品かを辿れなかった。
// 類度20回開いても再現せず、原因を特定できないまま終わっている。
//
// CIは `tools/local-test/results/` をアーティファクトとして保存するので、
// ここに書いておけば**次にCIで出たときにスタックが手に入る**。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "./_results.mjs";

// **`results/` 直下には置かない。** `build-report.mjs` はそこのJSONを読んで表を作るので、
// 形の違うJSONを置くと拾われて表が壊れる（README参照）。クエリ数の計測が
// `results/queries/` に分けてあるのと同じ形で、ここは `results/pageerrors/` に置く。
const OUT_DIR = join(RESULTS_DIR, "pageerrors");

/** 1回の実行で拾った例外。スイートをまたいで溜める */
const captured = [];

/**
 * ページの例外を監視する。表用の短い行は `problems` に積み、
 * 全文とスタックはこのモジュールに溜める。
 *
 * @param {import("playwright-core").Page} page
 * @param {string[]} problems 表の備考に出る配列（従来どおり短く切った1行を積む）
 * @param {string} [label] どのブロックで拾ったか（任意）
 */
export function watchPageErrors(page, problems, label = "") {
  page.on("pageerror", (error) => {
    problems.push(`例外: ${error.message}`.slice(0, 140));
    captured.push({
      label,
      url: page.url(),
      at: new Date().toISOString(),
      name: error.name,
      message: error.message,
      // **スタックはここだけに残る。** 本番ビルドなので名前は短縮されているが、
      // チャンク名と行番号が分かれば該当箇所まで辿れる
      stack: (error.stack ?? "").split("\n").slice(0, 25).join("\n"),
    });
  });
}

/**
 * 溜めた例外を書き出す。**0件でも必ず書く**——ファイルが無いと
 * 「例外が無かった」のか「この仕組みが動かなかった」のか区別できない
 * （docs/lessons.md の「沈黙を成功と解釈できる状態を作らない」）。
 */
export function writePageErrors(suite = "browser") {
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    suite,
    ranAt: new Date().toISOString(),
    count: captured.length,
    errors: captured,
  };
  writeFileSync(join(OUT_DIR, `${suite}.json`), JSON.stringify(payload, null, 2));
  if (captured.length > 0) {
    console.log(
      `[${suite}] ページ例外 ${captured.length} 件のスタックを results/pageerrors/${suite}.json に残した`
    );
  }
  return payload;
}
