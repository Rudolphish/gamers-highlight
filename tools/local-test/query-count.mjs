// ページ1回の描画で何回DBを引いているかを数える。
//
// 本番（Vercel → Supabaseプーラー）では1クエリが1往復ぶんの待ち時間になる。
// ローカルはUnixソケットなので所要時間そのものは当てにならない。**見るべきはクエリ数**。
//
// 使い方:
//   node tools/local-test/query-count.mjs            … 計測して表を出す
//   node tools/local-test/query-count.mjs --save 名前 … 結果を results/queries-<名前>.json に保存
//   node tools/local-test/query-count.mjs --compare 前 後 … 保存済みの2つを比較
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { RESULTS_DIR } from "./_results.mjs";

// **スイート結果（results/*.json）と同じ場所に置かない。**
// build-report.mjs は results/ 直下のJSONをスイートとして読むので、
// 形の違うこのファイルが混ざると docs/test-results.md が壊れる（実際に壊した）。
const QUERIES_DIR = join(RESULTS_DIR, "queries");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const PG_LOG = process.env.PG_LOG ?? "/tmp/pg.log";

const args = process.argv.slice(2);

// ── 比較モード ──
if (args[0] === "--compare") {
  const [, before, after] = args;
  const load = (n) => JSON.parse(readFileSync(join(QUERIES_DIR, `${n}.json`), "utf8"));
  const b = load(before);
  const a = load(after);
  const rows = b.rows.map((row) => {
    const now = a.rows.find((r) => r.page === row.page);
    const diff = (now?.queries ?? 0) - row.queries;
    return {
      ページ: row.page,
      [before]: row.queries,
      [after]: now?.queries ?? "—",
      増減: diff === 0 ? "±0" : diff > 0 ? `+${diff}` : String(diff),
    };
  });
  console.table(rows);
  const sumB = b.rows.reduce((n, r) => n + r.queries, 0);
  const sumA = a.rows.reduce((n, r) => n + r.queries, 0);
  console.log(`合計 ${sumB} → ${sumA} クエリ（${sumA - sumB >= 0 ? "+" : ""}${sumA - sumB}）`);
  process.exit(0);
}

// ── 計測モード ──
const db = new PrismaClient();
const admin = await db.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } });
const group = await db.group.findFirst({ where: { name: "テストグループ" }, select: { id: true } });
const album = await db.album.findFirst({ where: { title: "エルデンリング" }, select: { id: true } });
const game = await db.groupGame.findFirst({ where: { groupId: group.id }, select: { id: true } });

const cookie = `next-auth.session-token=${await encode({
  token: { name: "admin", email: "admin@example.com", sub: "admin@example.com", userId: admin.id },
  secret: SECRET,
  maxAge: 3600,
})}`;

const pages = [
  ["/", "ホーム"],
  ["/albums", "アルバム一覧"],
  ["/albums/unclassified", "未分類の投稿"],
  [`/albums/${album.id}`, "アルバム詳細"],
  ["/groups", "グループ一覧"],
  [`/groups/${group.id}`, "グループ詳細"],
  [`/groups/${group.id}/games/${game.id}`, "ゲーム詳細"],
  ["/admin", "管理・使用量"],
];

function pgctl(sql) {
  execFileSync("su", ["postgres", "-c", `psql -p 5433 -h /tmp -U postgres -d gh -c "${sql}"`], {
    stdio: "ignore",
  });
  execFileSync("su", ["postgres", "-c", "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/ghdata reload"], {
    stdio: "ignore",
  });
}

const logLines = () => readFileSync(PG_LOG, "utf8").split("\n").length;

pgctl("ALTER SYSTEM SET log_statement = 'all';");
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
try {
  for (const [path, label] of pages) {
    // 1回捨ててから測る（Next.jsの初回コンパイル等の揺れを除く）
    await fetch(BASE + path, { headers: { cookie } });
    await new Promise((r) => setTimeout(r, 300));

    const before = logLines();
    const t0 = Date.now();
    await fetch(BASE + path, { headers: { cookie } });
    const ms = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 400));
    const after = logLines();

    const chunk = readFileSync(PG_LOG, "utf8").split("\n").slice(before - 1, after - 1);
    const queries = chunk.filter((l) => l.includes("LOG:  execute")).length;
    const tables = {};
    for (const l of chunk) {
      const m = l.match(/FROM "public"\."([a-z_]+)"/);
      if (m) tables[m[1]] = (tables[m[1]] ?? 0) + 1;
    }
    rows.push({ page: label, path, queries, ms, tables });
  }
} finally {
  pgctl("ALTER SYSTEM SET log_statement = 'none';");
}

console.table(
  rows.map((r) => ({
    ページ: r.page,
    クエリ数: r.queries,
    "ローカル所要(ms)": r.ms,
    多いテーブル: Object.entries(r.tables)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, n]) => `${t}×${n}`)
      .join(" "),
  }))
);
console.log(`合計 ${rows.reduce((n, r) => n + r.queries, 0)} クエリ`);

const saveIdx = args.indexOf("--save");
if (saveIdx !== -1) {
  const name = args[saveIdx + 1];
  if (!existsSync(QUERIES_DIR)) mkdirSync(QUERIES_DIR, { recursive: true });
  writeFileSync(
    join(QUERIES_DIR, `${name}.json`),
    JSON.stringify({ name, measuredAt: new Date().toISOString(), rows }, null, 2)
  );
  console.log(`results/queries/${name}.json に保存した`);
}

await db.$disconnect();
