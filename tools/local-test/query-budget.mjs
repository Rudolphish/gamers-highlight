// Q: 主要ページ1回の描画で引くDBクエリの数に上限を置き、超えたら落とす。
//
// **見るのは所要時間ではなくクエリ数。** 本番（Vercel → Supabase）では1クエリ＝1往復の待ち時間に
// なるが、ここ（ローカル・CI）はソケット越しで速すぎて時間は当てにならない（docs/perf-cache.md）。
// 一度 71 → 27 まで減らしたものが、気づかないうちに戻らないようにするための見張り。
//
// 数え方は query-count.mjs と同じ（PostgreSQLの log_statement=all で、1回の描画のあいだに出た
// "execute" の行を数える）。違うのは **CIでも動く** こと：
//   - 設定は SQL（ALTER SYSTEM + pg_reload_conf）で切り替える（su も pg_ctl も要らない）
//   - ログの読み方は環境変数で渡す。CIはサービスコンテナなので PG_LOG_CMD="docker logs <id>"、
//     手元はファイルなので PG_LOG=/tmp/pg.log
//
// 上限を上げるときは、増えた理由を BUDGETS のコメントに書くこと（黙って上げると見張りの意味が消える）。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);

// [ID, ページ, パス, 上限]。上限は 2026-10-11 の実測（2・4・3・1・5・5）に、揺れの分として +2 を足した値。
// Q05 は 2026-10-14 から 6（管理者が開くとプレイ記録の最少人数を1回読む。測っているのが管理者のため）
// Q05 は 2026-10-18 から実測 7 → 上限 9。グループで遊んだ時間（帯とゲーム一覧。docs/play-log.md §13）のために、
// グループのプレイ記録をまとめて1回読み、記録があるときだけ Bot の生存報告を1回読む（進行中の回の終わりを決めるため）。
// ゲームの本数ぶん読む形にはしていない（増えるのは本数によらず最大2回）
const BUDGETS = [
  ["Q01", "ホーム", "/", 4],
  ["Q02", "アルバム一覧", "/albums", 6],
  ["Q03", "アルバム詳細", `/albums/${ids.albumId}`, 5],
  ["Q04", "グループ一覧", "/groups", 3],
  ["Q05", "グループ詳細", `/groups/${ids.groupId}`, 9],
  ["Q06", "ゲーム詳細", `/groups/${ids.groupId}/games/${ids.gameId}`, 7],
];

function readLog() {
  if (process.env.PG_LOG_CMD) {
    // docker logs は Postgres のログを stderr 側に出すので、まとめて読む
    return execSync(`${process.env.PG_LOG_CMD} 2>&1`, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: "/bin/bash" });
  }
  return readFileSync(process.env.PG_LOG ?? "/tmp/pg.log", "utf8");
}
const countExecutes = (text) => text.split("\n").filter((l) => l.includes("LOG:  execute")).length;

const db = new PrismaClient();
const admin = await db.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } });
const cookie = `next-auth.session-token=${await encode({
  token: { name: "admin", email: "admin@example.com", sub: "admin@example.com", userId: admin.id },
  secret: SECRET,
  maxAge: 3600,
})}`;

const setLogging = async (value) => {
  await db.$executeRawUnsafe(`ALTER SYSTEM SET log_statement = '${value}'`);
  await db.$queryRawUnsafe("SELECT pg_reload_conf()");
  await new Promise((r) => setTimeout(r, 1500));
};

const rows = [];
await setLogging("all");
try {
  for (const [id, label, path, budget] of BUDGETS) {
    // 1回捨ててから測る（キャッシュの作成・初回の揺れを除く。2回目以降の描画が本番で毎回かかる分）
    await fetch(BASE + path, { headers: { cookie } });
    await new Promise((r) => setTimeout(r, 500));
    const before = countExecutes(readLog());
    const res = await fetch(BASE + path, { headers: { cookie } });
    await res.text();
    await new Promise((r) => setTimeout(r, 800));
    const queries = countExecutes(readLog()) - before;
    rows.push({
      id,
      item: `${label} のDBクエリ数が上限以内`,
      expected: budget === null ? "計測のみ" : `≤${budget}`,
      actual: `${queries}`,
      ok: res.status === 200 && (budget === null || queries <= budget),
      note: res.status === 200 ? "" : `HTTP ${res.status}`,
    });
  }
} finally {
  await setLogging("none");
  await db.$disconnect();
}

const summary = writeResults("query-budget", "Q: 主要ページのDBクエリ数", rows);
console.table(rows.map((r) => ({ id: r.id, ページ: r.item, 上限: r.expected, 実測: r.actual, ok: r.ok })));
process.exitCode = summary.failed > 0 ? 1 : 0;
