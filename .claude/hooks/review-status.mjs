#!/usr/bin/env node
/**
 * いまのHEADがレビュー済みかを表示する。
 *
 * 自動レビュー（auto-review.mjs）はStopフックで静かに走るため、
 * **「PASSした」のか「そもそも走らなかった」のかが外から区別できない。**
 * 実際に2件のコミット（#47・#48）が未レビューのままマージされ、
 * 誰も気づかなかった。これはその穴を塞ぐための確認用コマンド。
 *
 *   node .claude/hooks/review-status.mjs         … HEADの状態を出す
 *   node .claude/hooks/review-status.mjs --range … セッション開始地点からの全コミット
 *
 * 終了コード: 0=レビュー済みでPASS / 1=未レビュー / 2=FAILのまま
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, "review-ledger.csv");
const STATE = join(HERE, ".review-state.json");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/**
 * 台帳を「コミット → 直近の判定」に畳む（同じコミットが再レビューされたら後勝ち）。
 *
 * **commits列は複数のSHAをセミコロンで連ねた形になりうる。**
 * auto-review.mjs は範囲にコミットが複数あればまとめて1回でレビューし、
 * `pending.shas.join(";")` で1行に書く。ここを単一SHAとして扱うと、
 * まとめてレビューされたコミットが軒並み「未レビュー」に見える
 * （＝レビュー済みを未レビューと誤検知する。このコマンドの信頼を落とす一番まずい壊れ方）。
 */
function loadVerdicts() {
  if (!existsSync(LEDGER)) return new Map();
  const map = new Map();
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    const cols = parseCsvLine(line);
    if (cols.length < 6) continue;
    const [at, , range, commits, verdict, findings, logFile] = cols;
    for (const commit of commits.split(";").filter(Boolean)) {
      // 実際に走ったレビュー（PASS/FAIL）が既にあるなら、後から来たSKIPで上書きしない。
      // まとめてスキップされた範囲に、個別にレビュー済みのコミットが混じることがあるため。
      if (verdict === "SKIP" && map.has(commit) && map.get(commit).verdict !== "SKIP") continue;
      map.set(commit, { at, range, verdict, findings, logFile });
    }
  }
  return map;
}

// findings列にはSKIP行だけ理由（自由記述）が入り、カンマを含みうるので
// 単純なsplit(",")では列がずれる。auto-review.mjs側と同じ解釈をする。
function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

const verdicts = loadVerdicts();
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const head = git("rev-parse", "HEAD");
const headShort = head.slice(0, 7);
const subject = git("log", "-1", "--format=%s", head);

const uncommitted = git("status", "--porcelain");
if (uncommitted) {
  console.log("⚠ 未コミットの変更があります。レビュー対象はコミット後に確定します。\n");
}

// --range の起点。auto-review.mjs と同じ決め方にしないと、
// 「フックがレビューした範囲」と「このコマンドが確認する範囲」がずれる。
// baseCommitがHEADから辿れない（squashマージ後にブランチを切り直した等）場合は、
// `rev-list <dead>..HEAD` が無関係なコミット群を返してしまうので使ってはいけない。
function rangeBase() {
  if (state.baseCommit) {
    try {
      git("merge-base", "--is-ancestor", state.baseCommit, head);
      return state.baseCommit;
    } catch {
      // 辿れない。既定ブランチとの分岐点に落とす（＝いまのブランチの中身）
    }
  }
  for (const ref of ["origin/HEAD", "origin/master", "origin/main", "master", "main"]) {
    try {
      return git("merge-base", head, git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`));
    } catch {
      // この候補は無い
    }
  }
  return head;
}

const rangeMode = process.argv.includes("--range");
const wanted = rangeMode ? git("rev-list", `${rangeBase()}..HEAD`).split("\n").filter(Boolean) : [head];

// **空を「問題なし」と表示してはいけない。** ここで黙って通すと、
// 「レビュー済み」と「そもそも対象が無い（＝基準点がHEADまで進んでしまった）」が
// 区別できず、このコマンドを作った理由そのものを再現してしまう。
if (rangeMode && wanted.length === 0) {
  console.log(
    `対象コミットがありません。\n` +
      `  セッション開始地点(baseCommit) = ${(state.baseCommit ?? "未記録").slice(0, 7)}\n` +
      `  HEAD                          = ${headShort}\n\n` +
      `この2つが同じなら、基準点がHEADまで進んでいます。それ以前のコミットは\n` +
      `レビュー対象から外れているので、個別に確認してください（--range なしで実行）。`
  );
  process.exit(1);
}

let worst = 0;
for (const commit of wanted) {
  const short = commit.slice(0, 7);
  const title = git("log", "-1", "--format=%s", commit).slice(0, 48);
  const found = verdicts.get(commit);
  if (!found) {
    console.log(`✗ ${short} ${title}\n    未レビュー（台帳に記録がありません）`);
    worst = Math.max(worst, 1);
  } else if (found.verdict === "SKIP") {
    // レビューは走らなかった。PASSと混ぜないこと（混ぜたら見送りが見えなくなる）。
    console.log(`✗ ${short} ${title}\n    未レビュー（見送り: ${found.findings}）`);
    worst = Math.max(worst, 1);
  } else if (found.verdict === "PASS") {
    console.log(`✓ ${short} ${title}\n    PASS（${found.at}）`);
  } else {
    console.log(`✗ ${short} ${title}\n    ${found.verdict} 指摘${found.findings}件 → docs/review-log/${found.logFile}`);
    worst = Math.max(worst, 2);
  }
}

if (wanted.length === 1 && wanted[0] === head) {
  console.log(`\nHEAD: ${headShort} ${subject.slice(0, 60)}`);
}
console.log(
  worst === 0
    ? "\n判定: レビュー済み（PASS）"
    : worst === 1
      ? "\n判定: 未レビュー。マージ前に確認すること"
      : "\n判定: 指摘が残っています"
);
process.exit(worst);
