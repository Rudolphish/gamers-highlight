// APIの権限まわりを役割ごとに叩いて期待値と突き合わせる。
import { encode } from "next-auth/jwt";

const BASE = "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const ids = JSON.parse(process.env.SEED_IDS);

async function cookieFor(email) {
  const token = await encode({ token: { name: email, email, sub: email }, secret: SECRET, maxAge: 3600 });
  return `next-auth.session-token=${token}`;
}

const cookies = {
  anon: null,
  admin: await cookieFor("admin@example.com"),
  member: await cookieFor("member@example.com"),
  outsider: await cookieFor("outsider@example.com"),
};

// [説明, メソッド, パス, ボディ, {役割: 期待ステータス}]
const cases = [
  ["アルバム取得（他人のアルバム）", "GET", `/api/albums/${ids.otherAlbumId}`, null, { anon: 401, admin: 403, member: 403, outsider: 200 }],
  ["アルバム写真一覧（他人）", "GET", `/api/albums/${ids.otherAlbumId}/photos`, null, { anon: 401, admin: 403, outsider: 200 }],
  ["アルバム取得（自分の）", "GET", `/api/albums/${ids.albumId}`, null, { admin: 200, member: 200, outsider: 403 }],
  ["アルバム削除（部外者）", "DELETE", `/api/albums/${ids.albumId}`, null, { outsider: 403 }],
  ["アルバム更新（部外者）", "PATCH", `/api/albums/${ids.albumId}`, { title: "乗っ取り" }, { outsider: 403 }],
  ["他人のグループにアルバム作成", "POST", "/api/albums", { title: "侵入", groupId: ids.groupId }, { outsider: 403 }],
  ["グループ一覧", "GET", "/api/groups", null, { anon: 401, admin: 200, outsider: 200 }],
  ["グループ取得（他人）", "GET", `/api/groups/${ids.groupId}`, null, { outsider: 403 }],
  ["グループのゲーム一覧（他人）", "GET", `/api/groups/${ids.groupId}/games`, null, { outsider: 403 }],
  ["提案一覧（他人）", "GET", `/api/groups/${ids.groupId}/proposals`, null, { outsider: 403 }],
  ["提案にリアクション（他人）", "POST", `/api/groups/${ids.groupId}/proposals/${ids.proposalId}/reactions`, { type: "LIKE" }, { outsider: 403 }],
  ["ゲームに「気になる」（他人）", "POST", `/api/groups/${ids.groupId}/games/${ids.gameId}/interest`, {}, { outsider: 403 }],
  ["招待リンク発行（メンバーだがOWNERでない）", "POST", `/api/groups/${ids.groupId}/invites`, { role: "VIEWER", maxUses: 1, expiresInHours: 24 }, { member: 403, outsider: 403 }],
  ["メンバー追加（部外者）", "POST", `/api/groups/${ids.groupId}/members`, { userId: ids.outsiderId, role: "VIEWER" }, { outsider: 403 }],
  // 管理者は/adminのメディア一覧から誰の投稿でも消せる（容量整理のための意図した挙動）
  ["写真削除（管理者は他人の写真も消せる＝仕様）", "DELETE", `/api/photos/${ids.outsiderPhotoId ?? "missing"}`, null, { member: 403, admin: 200 }],
  // 未ログインもフェイルクローズで403（401ではない）
  ["許可リスト一覧（非管理者）", "GET", "/api/allowlist", null, { anon: 403, admin: 200, member: 403, outsider: 403 }],
  ["許可リスト追加（非管理者）", "POST", "/api/allowlist", { email: "intruder@example.com" }, { member: 403, outsider: 403 }],
  ["エラー通知先の変更（非管理者）", "POST", "/api/admin/error-notify", { channelId: "123" }, { member: 403, outsider: 403 }],
  ["招待の取り消し（管理者API・非管理者）", "DELETE", `/api/admin/invites/${ids.inviteId ?? "missing"}`, null, { member: 403, outsider: 403 }],
  ["cron（シークレット無し）", "GET", "/api/cron/check-wishlist-prices", null, { anon: 401 }],
  ["cron（bot health・シークレット無し）", "GET", "/api/cron/check-bot-health", null, { anon: 401 }],
  ["内部API（シークレット無し）", "GET", "/api/internal/group-games?guildId=1", null, { anon: 401 }],
  ["Discord取り込み（シークレット無し）", "POST", "/api/discord/ingest", {}, { anon: 401 }],
  ["ゲーム判別（シークレット無し）", "POST", "/api/internal/assign-game", {}, { anon: 401 }],
  ["Steam検索", "GET", "/api/steam/search?q=elden", null, { anon: 401, admin: 200 }],
  ["写真検索", "GET", "/api/photos/search?q=ELDEN", null, { anon: 401, admin: 200 }],
  ["ゲーム横断検索", "GET", "/api/search/group-games?q=elden", null, { anon: 401, admin: 200 }],
  ["ユーザー一覧", "GET", "/api/users", null, { anon: 401, admin: 200 }],
  ["自分の情報", "GET", "/api/users/me", null, { anon: 401, admin: 200 }],
  ["アップロードURL発行", "POST", "/api/photos/upload-url", { contentType: "image/png", mediaType: "IMAGE", sizeBytes: 1024 }, { anon: 401, admin: 201 }],
  ["アルバム詳細ページ（権限なし）", "GET", `/albums/${ids.otherAlbumId}`, null, { admin: 404, member: 404, outsider: 200 }],
  ["アルバム詳細ページ（権限あり）", "GET", `/albums/${ids.albumId}`, null, { admin: 200, member: 200, outsider: 404 }],
];

const results = [];
for (const [label, method, path, body, expects] of cases) {
  for (const [role, expected] of Object.entries(expects)) {
    const cookie = cookies[role];
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const ok = res.status === expected;
    let detail = "";
    if (!ok) detail = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    results.push({ 結果: ok ? "OK" : "NG", 役割: role, 期待: expected, 実際: res.status, 内容: label, detail });
  }
}

console.table(results.filter((r) => r.結果 === "NG"));
console.log(`\n合計 ${results.length} 件、NG ${results.filter((r) => r.結果 === "NG").length} 件`);
