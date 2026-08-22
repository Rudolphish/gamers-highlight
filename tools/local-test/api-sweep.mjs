// R: APIの権限。役割ごとに叩いて期待ステータスと突き合わせる。
import { encode } from "next-auth/jwt";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
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

// [ID, 説明, メソッド, パス, ボディ, {役割: 期待ステータス}]
const cases = [
  ["R01", "アルバム取得（他人のアルバム）", "GET", `/api/albums/${ids.otherAlbumId}`, null, { anon: 401, admin: 403, member: 403, outsider: 200 }],
  ["R02", "アルバムの写真一覧（他人のアルバム）", "GET", `/api/albums/${ids.otherAlbumId}/photos`, null, { anon: 401, admin: 403, outsider: 200 }],
  ["R03", "アルバム取得（自分が見られるもの）", "GET", `/api/albums/${ids.albumId}`, null, { admin: 200, member: 200, outsider: 403 }],
  ["R04", "アルバム削除（権限なし）", "DELETE", `/api/albums/${ids.albumId}`, null, { outsider: 403 }],
  ["R05", "アルバム更新（権限なし）", "PATCH", `/api/albums/${ids.albumId}`, { title: "乗っ取り" }, { outsider: 403 }],
  ["R06", "他人のグループにアルバム作成", "POST", "/api/albums", { title: "侵入", groupId: ids.groupId }, { outsider: 403 }],
  ["R07", "グループ一覧（自分の所属だけ返る）", "GET", "/api/groups", null, { anon: 401, admin: 200, outsider: 200 }],
  ["R08", "グループ取得（他人のグループ）", "GET", `/api/groups/${ids.groupId}`, null, { outsider: 403 }],
  ["R09", "グループのゲーム一覧（他人のグループ）", "GET", `/api/groups/${ids.groupId}/games`, null, { outsider: 403 }],
  ["R10", "提案一覧（他人のグループ）", "GET", `/api/groups/${ids.groupId}/proposals`, null, { outsider: 403 }],
  ["R11", "提案へのリアクション（他人のグループ）", "POST", `/api/groups/${ids.groupId}/proposals/${ids.proposalId}/reactions`, { type: "LIKE" }, { outsider: 403 }],
  ["R12", "ゲームに「気になる」（他人のグループ）", "POST", `/api/groups/${ids.groupId}/games/${ids.gameId}/interest`, {}, { outsider: 403 }],
  ["R13", "招待リンク発行はOWNERのみ", "POST", `/api/groups/${ids.groupId}/invites`, { role: "VIEWER", maxUses: 1, expiresInHours: 24 }, { member: 403, outsider: 403 }],
  ["R14", "メンバー追加（権限なし）", "POST", `/api/groups/${ids.groupId}/members`, { userId: ids.outsiderId, role: "VIEWER" }, { outsider: 403 }],
  // 管理者は/adminのメディア一覧から誰の投稿でも消せる（容量整理のための意図した挙動）
  ["R15", "写真削除（管理者は他人の写真も消せる＝仕様）", "DELETE", `/api/photos/${ids.outsiderPhotoId}`, null, { member: 403, admin: 200 }],
  // 未設定・未ログインでも通さないフェイルクローズ（401ではなく403）
  ["R16", "許可リスト一覧は管理者のみ", "GET", "/api/allowlist", null, { anon: 403, admin: 200, member: 403, outsider: 403 }],
  ["R17", "許可リスト追加は管理者のみ", "POST", "/api/allowlist", { email: "intruder@example.com" }, { member: 403, outsider: 403 }],
  ["R18", "エラー通知先の変更は管理者のみ", "POST", "/api/admin/error-notify", { channelId: "123" }, { member: 403, outsider: 403 }],
  ["R19", "招待の取り消し（管理者API）は管理者のみ", "DELETE", `/api/admin/invites/${ids.inviteId}`, null, { member: 403, outsider: 403 }],
  ["R20", "cron（価格チェック）はシークレット必須", "GET", "/api/cron/check-wishlist-prices", null, { anon: 401 }],
  // 写真リアクション。閲覧できる人（VIEWER以上）なら誰でも押せる＝memberは200。
  // 部外者はそのアルバムを見られないので403、未ログインは401
  ["R21", "写真リアクションは閲覧できる人なら押せる", "POST", `/api/photos/${ids.memberPhotoId}/reactions`, null, { anon: 401, outsider: 403, member: 200 }],
  ["R22", "未分類の写真にはリアクションできない", "POST", `/api/photos/${ids.unclassifiedPhotoId}/reactions`, null, { admin: 400 }],
  // 写真の説明。見られる人（＝グループのメンバー）なら書ける＝memberは200。
  // 部外者はそのアルバムを見られないので403、未ログインは401
  ["R23", "写真の説明は見られる人なら書ける", "PATCH", `/api/photos/${ids.memberPhotoId}`, { description: "テストの説明" }, { anon: 401, outsider: 403, member: 200 }],
  ["R24", "未分類の写真には説明を付けられない", "PATCH", `/api/photos/${ids.unclassifiedPhotoId}`, { description: "x" }, { admin: 400 }],
  ["R25", "説明の文字数上限を超えると拒否", "PATCH", `/api/photos/${ids.memberPhotoId}`, { description: "あ".repeat(501) }, { admin: 400 }],
  ["R21", "cron（Bot死活）はシークレット必須", "GET", "/api/cron/check-bot-health", null, { anon: 401 }],
  ["R22", "内部API（ゲーム一覧）はシークレット必須", "GET", "/api/internal/group-games?guildId=1", null, { anon: 401 }],
  ["R23", "Discord取り込みはシークレット必須", "POST", "/api/discord/ingest", {}, { anon: 401 }],
  ["R24", "ゲーム判別（内部API）はシークレット必須", "POST", "/api/internal/assign-game", {}, { anon: 401 }],
  ["R25", "Steam検索は要ログイン", "GET", "/api/steam/search?q=elden", null, { anon: 401, admin: 200 }],
  ["R26", "写真検索は要ログイン", "GET", "/api/photos/search?q=ELDEN", null, { anon: 401, admin: 200 }],
  ["R27", "ゲーム横断検索は要ログイン", "GET", "/api/search/group-games?q=elden", null, { anon: 401, admin: 200 }],
  ["R28", "ユーザー一覧は要ログイン", "GET", "/api/users", null, { anon: 401, admin: 200 }],
  ["R29", "自分の情報は要ログイン", "GET", "/api/users/me", null, { anon: 401, admin: 200 }],
  ["R30", "アップロードURL発行は要ログイン", "POST", "/api/photos/upload-url", { contentType: "image/png", sizeBytes: 1024 }, { anon: 401, admin: 201 }],
];

const rows = [];
for (const [id, label, method, path, body, expects] of cases) {
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
    rows.push({
      id: `${id}/${role}`,
      item: `${label}（${role}）`,
      expected: String(expected),
      actual: String(res.status),
      ok,
      note: ok ? "" : (await res.text()).slice(0, 120).replace(/\s+/g, " "),
    });
  }
}

const summary = writeResults("api", "R: APIの権限", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
