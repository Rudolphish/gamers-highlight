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
  // 2026-10-11 の棚卸しで足した。どれもゲームの外部情報（カバー・価格・クリア時間）を引くページ
  // X06 の提案は下で作る（シードの提案は flows の F23 が採用済みにするので、開くとゲーム詳細へ転送される）
  ["X06", "提案詳細（Steam・ITADを引く）", null],
  ["X07", "アルバム詳細（Steamのカバーを引く）", `/albums/${ids.albumId}`],
  ["X08", "グループ一覧（Steamのカバーを引く）", "/groups"],
  // ウィッシュリストの価格（Steam・ITADを引く）。1件落ちても他は返し、全部落ちても500にしない
  ["X09", "ウィッシュリストの価格API（Steam・ITADを引く）", `/api/groups/${ids.groupId}/proposals/prices`],
];

// X06 用に、採用されていない提案を自分で作る。**シードの提案（ids.proposalId）は使えない。**
// flows の F23 がそれを採用済みにするので、開くと提案詳細ではなくゲーム詳細へ 307 で転送される。
// loading.tsx があった頃はこの転送も200で返っていたため、**提案詳細を一度も描かないまま通っていた**
// （2026-10-22 に loading.tsx を外して 307 が見えるようになり発覚）。外部APIを落とす前に作り、同じAPIで消す
const api = (path, init = {}) =>
  fetch(BASE + path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) }, redirect: "manual" });
const PROPOSAL_TITLE = "外部障害確認用の提案";
let proposalId = null;
let proposalError = "";
// fetch-stub が appdetails を返す app ID のうち、このグループでまだ追加・提案されていないものを使う
for (const steamAppId of [292030, 570, 271590, 1245620, 1174180, 1091500]) {
  const res = await api(`/api/groups/${ids.groupId}/proposals`, { method: "POST", body: JSON.stringify({ steamAppId, title: PROPOSAL_TITLE }) });
  if (res.status === 201) {
    proposalId = (await res.json()).proposal?.id ?? null;
    break;
  }
  proposalError = `${steamAppId}: ${res.status}`;
}
const x06 = targets.find(([id]) => id === "X06");
x06[2] = proposalId ? `/groups/${ids.groupId}/proposals/${proposalId}` : null;

// fetch-stub.cjs がこのファイルを見て、書かれたホストへの外部呼び出しを500にする
writeFileSync("/tmp/stub-fail", "*");

const rows = [];
try {
  for (const [id, label, path] of targets) {
    if (!path) {
      rows.push({ id, item: `外部API全滅時でも描画される: ${label}`, expected: "200", actual: "未確認", ok: false, note: `確認用の提案を作れなかった（${proposalError}）` });
      continue;
    }
    const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    const boundary = body.includes("問題が発生しました") || body.includes("Application error");
    // 提案詳細は、転送されずに本当に提案が描かれたかを本文で見る
    const missing = id === "X06" && !body.includes(PROPOSAL_TITLE);
    rows.push({
      id,
      item: `外部API全滅時でも描画される: ${label}`,
      expected: id === "X06" ? "200・提案のタイトルが出る" : "200",
      actual: String(res.status) + (id === "X06" ? (missing ? "・タイトル無し" : "・タイトルあり") : ""),
      ok: res.status === 200 && !boundary && !missing,
      note: boundary ? "エラーバウンダリが表示された" : "",
    });
  }
} finally {
  unlinkSync("/tmp/stub-fail");
  if (proposalId) await api(`/api/groups/${ids.groupId}/proposals/${proposalId}`, { method: "DELETE" }).catch(() => {});
}

const summary = writeResults("external-failure", "X: 外部APIが落ちている状態", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
