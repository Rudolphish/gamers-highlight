// 全ページを3ユーザー＋未ログインで舐めて、ステータスと最終URLを見る。
// 500 と「未ログインなのに描画まで進む」を洗い出すのが目的。
import { encode } from "next-auth/jwt";

const BASE = "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

const ids = JSON.parse(process.env.SEED_IDS);

async function cookieFor(email, name) {
  const token = await encode({ token: { name, email, sub: email }, secret: SECRET, maxAge: 3600 });
  return `next-auth.session-token=${token}`;
}

const paths = [
  "/",
  "/login",
  "/albums",
  "/albums/new",
  "/albums/unclassified",
  `/albums/${ids.albumId}`,
  `/albums/${ids.otherAlbumId}`,
  "/groups",
  "/groups/new",
  `/groups/${ids.groupId}`,
  `/groups/${ids.otherGroupId}`,
  `/groups/${ids.groupId}/albums/new`,
  `/groups/${ids.groupId}/games/${ids.gameId}`,
  `/groups/${ids.groupId}/proposals/${ids.proposalId}`,
  "/manual",
  "/search",
  "/upload",
  "/settings/profile",
  "/settings/allowlist",
  "/settings/discord",
  "/settings/channel-mapping",
  "/admin",
  "/admin/errors",
  "/admin/invites",
  "/admin/media",
  "/admin/users",
  `/invite/${ids.inviteToken}`,
  "/invite/test-invite-expired",
  "/invite/test-invite-revoked",
  "/invite/does-not-exist",
];

const users = [
  { label: "anon", cookie: null },
  { label: "admin", cookie: await cookieFor("admin@example.com", "管理者ユーザー") },
  { label: "member", cookie: await cookieFor("member@example.com", "一般メンバー") },
  { label: "outsider", cookie: await cookieFor("outsider@example.com", "部外者") },
];

const rows = [];
for (const path of paths) {
  const row = { path };
  for (const u of users) {
    const res = await fetch(BASE + path, {
      headers: u.cookie ? { cookie: u.cookie } : {},
      redirect: "manual",
    });
    let cell = String(res.status);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      cell += ` →${loc.replace(BASE, "").split("?")[0]}`;
    } else if (res.status === 200) {
      const body = await res.text();
      // Next.jsのエラーバウンダリが出ている場合を拾う
      if (body.includes("問題が発生しました") || body.includes("Application error")) cell += " (error-boundary)";
    }
    row[u.label] = cell;
  }
  rows.push(row);
}

console.table(rows);
