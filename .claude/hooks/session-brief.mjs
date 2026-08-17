#!/usr/bin/env node
/**
 * SessionStart hook: セッションの最初に「前のセッションまでの学び」と
 * 「いま未レビューで残っているもの」を出す。
 *
 * **なぜファイルを置くだけでは足りないか。**
 * `.claude/hooks/review-decisions.csv` は「決着済みの論点を書き足す」ための
 * ファイルだったが、作った日以降1行も増えていない。手で書きに行く前提のものは
 * 例外なく風化する。だから読ませる側を仕組みにする。
 *
 * 出力はセッションの冒頭コンテキストに載る。長いほど読まれなくなるので、
 * docs/lessons.md が肥大したら畳むよう警告する（中身の要約はしない。
 * 要約すると「何が起きたか」が落ちて、判断に使えない項目だけが残る）。
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const LESSONS = join(REPO_ROOT, "docs", "lessons.md");
const LEDGER = join(HERE, "review-ledger.csv");

// これを超えたら畳む合図。CLAUDE.mdと合わせて毎回読む量なので、無制限には増やせない
const LESSONS_SOFT_LIMIT = 8 * 1024;

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const out = [];

// ── 進め方の記録 ──
if (existsSync(LESSONS)) {
  const text = readFileSync(LESSONS, "utf8");
  out.push("## docs/lessons.md（進め方でやらかしたことの記録・全文）\n");
  out.push(text.trim());
  if (text.length > LESSONS_SOFT_LIMIT) {
    out.push(
      `\n> ⚠ docs/lessons.md が ${Math.round(text.length / 1024)}KB あります` +
        `（目安 ${LESSONS_SOFT_LIMIT / 1024}KB）。似た項目を統合して畳んでください。`
    );
  }
} else {
  out.push("docs/lessons.md がありません。進め方でやらかしたことは、ここに残してください。");
}

// ── いま未レビューで残っているもの ──
// レビューが飛んでいたことに気づけなかった原因は「走らなかったのが見えない」ことだった。
// セッションの頭で残件を出しておけば、前のセッションの積み残しをそのまま引き継げる。
const head = git("rev-parse", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (head && existsSync(LEDGER)) {
  let base = null;
  for (const ref of ["origin/HEAD", "origin/master", "origin/main", "master", "main"]) {
    const tip = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    if (!tip) continue;
    const fork = git("merge-base", head, tip);
    if (fork && fork !== head) {
      base = fork;
      break;
    }
  }

  if (base) {
    const reviewed = new Set();
    const failed = new Map();
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      const cols = parseCsvLine(line);
      if (cols.length < 6) continue;
      const [, , , commits, verdict] = cols;
      for (const sha of commits.split(";").filter(Boolean)) {
        if (verdict === "PASS") {
          reviewed.add(sha);
          failed.delete(sha);
        } else if (verdict === "FAIL") {
          failed.set(sha, true);
        }
      }
    }

    const commits = (git("rev-list", `${base}..${head}`) ?? "").split("\n").filter(Boolean);
    const pending = commits.filter((c) => !reviewed.has(c));
    if (pending.length > 0) {
      out.push(`\n## いまのブランチ（${branch}）に未レビューのコミットが ${pending.length} 件あります\n`);
      for (const c of pending.slice(0, 10)) {
        const subject = git("log", "-1", "--format=%s", c) ?? "";
        out.push(`- ${failed.has(c) ? "FAIL" : "未レビュー"} ${c.slice(0, 7)} ${subject.slice(0, 60)}`);
      }
      out.push(`\nマージ前に \`node .claude/hooks/review-status.mjs --range\` で確認してください。`);
    }
  }
}

console.log(out.join("\n"));

// auto-review.mjs と同じ解釈（findings列はSKIP行だけ自由記述でカンマを含みうる）
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
