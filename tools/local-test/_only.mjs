// ブラウザのテストを「変えた所だけ」流すための絞り込み（2026-11-03）。
//
// 改修1回あたりのテストが25分前後かかっていて、その半分は手元の通し（6分×2回）だった。
// 通しの8割はブラウザ（browser.mjs・5分強）で、**同じものを CI がもう一度まるごと流す。**
// そこで手元は変えた所に関係する区画だけを流し、全件は CI に任せる。
//
//   BROWSER_ONLY=B157 node tools/local-test/run-all.mjs
//   BROWSER_ONLY=B133-B142,B153 node tools/local-test/run-all.mjs
//
// - 区画は browser.mjs の行頭の `if (block()) {` 〜 行頭の `}`。**区画の中に書かれたテスト ID
//   （コメントを除く）を、このファイルが browser.mjs の文面から読み取る。** ID の一覧を別に書くと、
//   テストを足したときにそこだけ古くなる（CLAUDE.md「ブラウザテストのラベルだけは書き写している」）
// - 選ばれるのは区画ごと。同じ区画の別の ID も一緒に流れる（区画の中で準備を共有しているため）
// - **1つも当たらなければ落とす**（打ち間違いで「0件・NG 0」になるのを防ぐ）
// - 絞ったときは results/browser.json を書かない。全件の表（docs/test-results.md）が
//   一部だけの結果で作り直されないように
import { readFileSync } from "node:fs";

const RAW = (process.env.BROWSER_ONLY ?? "").trim();

/** 絞り込み中か */
export const FILTERED = RAW !== "";

/** "B157" → [157, ""]、"B19b" → [19, "b"] */
function parseId(id) {
  const m = /^B(\d+)([a-z]?)$/.exec(id);
  if (!m) throw new Error(`BROWSER_ONLY の書き方が違います: ${id}（例: B157 / B133-B142）`);
  return [Number(m[1]), m[2]];
}

const wantedRanges = RAW.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((part) => {
    const [from, to = from] = part.split("-").map((s) => s.trim());
    return [parseId(from)[0], parseId(to)[0]];
  });

/** この ID を流すか（絞り込んでいなければ全部 true） */
export function wanted(id) {
  if (!FILTERED) return true;
  const [n] = parseId(id);
  return wantedRanges.some(([a, b]) => n >= a && n <= b);
}

/**
 * browser.mjs の区画ごとの ID を、文面から読み取る。
 * 行頭の `if (block()) {` から、次の行頭の `}` までを1区画とみなす。
 */
export function readBlocks(sourcePath) {
  const lines = readFileSync(sourcePath, "utf8").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "if (block()) {") continue;
    const ids = new Set();
    let j = i + 1;
    for (; j < lines.length && lines[j] !== "}"; j++) {
      const code = lines[j].replace(/^\s*\/\/.*$/, "");
      for (const m of code.matchAll(/["'`]?\b(B\d{2,3}[a-z]?)\b["'`]?\s*[:,)]/g)) ids.add(m[1]);
    }
    blocks.push({ line: i + 1, ids: [...ids] });
    i = j;
  }
  return blocks;
}

/**
 * 区画の入口で呼ぶ関数を作る。`outsideIds` は区画の外で流すもの（主要ページを開く B01〜B19b）。呼ばれた順に区画を数え、その区画に流す ID があれば true。
 * 区画の数と呼ばれた回数が合わない（区画の外で呼んだ・書き方が違う）と、別の区画を飛ばしてしまうので落とす。
 */
export function makeBlockGate(sourcePath, outsideIds = []) {
  const blocks = readBlocks(sourcePath);
  // ID を1つも読み取れない区画は、絞り込みでは決して選ばれない（全件では流れるので気づけない）。
  // ID の書き方が `"B123",` `B123:` `"B123")` のどれでもないときに起きるので、ここで止める
  const blind = blocks.filter((b) => b.ids.length === 0);
  if (blind.length > 0) {
    throw new Error(`テスト ID を読み取れない区画があります（browser.mjs ${blind.map((b) => `${b.line}行目`).join("・")}）。_only.mjs の readBlocks を参照`);
  }
  if (FILTERED) {
    const hit = blocks.filter((b) => b.ids.some(wanted));
    if (hit.length === 0 && !outsideIds.some(wanted)) {
      throw new Error(`BROWSER_ONLY=${RAW} に当たる区画がありません（ID を確かめてください）`);
    }
    console.log(`[browser] 絞り込み ${RAW}: ${blocks.length} 区画のうち ${hit.length} 区画を流す（${hit.map((b) => b.ids.join("/")).join("、")}）`);
  }
  let index = 0;
  const gate = () => {
    const b = blocks[index++];
    if (!b) throw new Error("block() の呼び出しが区画の数より多い（行頭の `if (block()) {` 以外で呼んでいないか）");
    return !FILTERED || b.ids.some(wanted);
  };
  gate.done = () => {
    if (index !== blocks.length) throw new Error(`block() が ${index} 回しか呼ばれていない（区画は ${blocks.length}）`);
  };
  return gate;
}
