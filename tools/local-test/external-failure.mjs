// X: 外部APIが落ちている状態でも、ページ全体が500にならないこと。
// 1つの取得失敗でページを落とさない（Promise.allSettledでセクション単位に握りつぶす）方針の確認。
import { writeFileSync, unlinkSync } from "node:fs";
import { encode } from "next-auth/jwt";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);

const cookie = `next-auth.session-token=${await encode({
  token: { name: "admin", email: "admin@example.com", sub: "admin@example.com" },
  secret: SECRET,
  maxAge: 3600,
})}`;

const targets = [
  ["X01", "ホーム", "/"],
  ["X02", "グループ詳細", `/groups/${ids.groupId}`],
  ["X03", "ゲーム詳細（Steam・ITAD・YouTubeを全部引く）", `/groups/${ids.groupId}/games/${ids.gameId}`],
  ["X04", "アルバム一覧（Steamのカバーを引く）", "/albums"],
  ["X05", "管理・使用量（R2とDBを実測する）", "/admin"],
];

// fetch-stub.cjs がこのファイルを見て、書かれたホストへの外部呼び出しを500にする
writeFileSync("/tmp/stub-fail", "*");

const rows = [];
try {
  for (const [id, label, path] of targets) {
    const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    const boundary = body.includes("問題が発生しました") || body.includes("Application error");
    rows.push({
      id,
      item: `外部API全滅時でも描画される: ${label}`,
      expected: "200",
      actual: String(res.status),
      ok: res.status === 200 && !boundary,
      note: boundary ? "エラーバウンダリが表示された" : "",
    });
  }
} finally {
  unlinkSync("/tmp/stub-fail");
}

const summary = writeResults("external-failure", "X: 外部APIが落ちている状態", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
