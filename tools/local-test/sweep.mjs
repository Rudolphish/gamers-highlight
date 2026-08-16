// P: ページの到達性と権限。全ページを未ログイン＋3役割で開き、期待ステータスと突き合わせる。
// 「未ログインなのに描画まで進む」「権限が無いのに中身が出る」を洗い出すのが目的。
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

// 未ログインは (main) 配下なら必ずログインへ飛ばされる（middlewareのmatcher漏れの検出）
const LOGIN = "307:/api/auth/signin";
const OK = 200;

/**
 * 「見えないこと」の期待値。**ステータスだけで判定してはいけない。**
 *
 * `loading.tsx` があるルートはNext.jsがストリーミングを始め、ヘッダーを先に送ってしまうため、
 * ページ関数が後から `notFound()` してもHTTPステータスは200のまま、
 * 本文の途中でnot-found画面に差し替わる（#33で loading.tsx を入れた際に
 * 権限拒否のページが軒並み200になり、実際にこれで引っかかった）。
 *
 * 中身が出ていないかどうかが本題なので、not-found画面が返っていれば合格とする。
 */
const NF = "見えない";

// [ID, 説明, パス, {役割: 期待}]
const cases = [
  ["P01", "ホーム", "/", { anon: LOGIN, admin: OK, member: OK, outsider: OK }],
  ["P02", "ログイン画面", "/login", { anon: OK, admin: OK }],
  ["P03", "アルバム一覧", "/albums", { anon: LOGIN, admin: OK, member: OK, outsider: OK }],
  ["P04", "アルバム作成", "/albums/new", { anon: LOGIN, admin: OK }],
  ["P05", "未分類の投稿", "/albums/unclassified", { anon: LOGIN, admin: OK, member: OK }],
  ["P06", "アルバム詳細（自分が見られるもの）", `/albums/${ids.albumId}`, { anon: LOGIN, admin: OK, member: OK, outsider: NF }],
  ["P07", "アルバム詳細（他人のもの）", `/albums/${ids.otherAlbumId}`, { anon: LOGIN, admin: NF, member: NF, outsider: OK }],
  ["P08", "グループ一覧", "/groups", { anon: LOGIN, admin: OK, member: OK, outsider: OK }],
  ["P09", "グループ作成", "/groups/new", { anon: LOGIN, admin: OK }],
  ["P10", "グループ詳細（自分のグループ）", `/groups/${ids.groupId}`, { anon: LOGIN, admin: OK, member: OK, outsider: NF }],
  ["P11", "グループ詳細（他人のグループ）", `/groups/${ids.otherGroupId}`, { anon: LOGIN, admin: NF, member: NF, outsider: OK }],
  ["P12", "グループ内アルバム作成", `/groups/${ids.groupId}/albums/new`, { anon: LOGIN, admin: OK, member: OK }],
  ["P13", "ゲーム詳細", `/groups/${ids.groupId}/games/${ids.gameId}`, { anon: LOGIN, admin: OK, member: OK, outsider: NF }],
  ["P14", "提案詳細", `/groups/${ids.groupId}/proposals/${ids.proposalId}`, { anon: LOGIN, admin: OK, member: OK, outsider: NF }],
  ["P15", "マニュアル", "/manual", { anon: LOGIN, admin: OK }],
  ["P16", "検索", "/search", { anon: LOGIN, admin: OK, member: OK }],
  ["P17", "アップロード", "/upload", { anon: LOGIN, admin: OK, member: OK }],
  ["P18", "設定・プロフィール", "/settings/profile", { anon: LOGIN, admin: OK, member: OK }],
  ["P19", "設定・許可リスト", "/settings/allowlist", { anon: LOGIN, admin: OK, member: OK }],
  ["P20", "設定・Discord連携", "/settings/discord", { anon: LOGIN, admin: OK }],
  ["P21", "設定・チャンネル対応", "/settings/channel-mapping", { anon: LOGIN, admin: OK }],
  ["P22", "管理・使用量（管理者のみ）", "/admin", { anon: LOGIN, admin: OK, member: NF, outsider: NF }],
  ["P23", "管理・エラー", "/admin/errors", { anon: LOGIN, admin: OK, member: NF }],
  ["P24", "管理・招待リンク", "/admin/invites", { anon: LOGIN, admin: OK, member: NF }],
  ["P25", "管理・メディア一覧", "/admin/media", { anon: LOGIN, admin: OK, member: NF }],
  ["P26", "管理・ユーザー", "/admin/users", { anon: LOGIN, admin: OK, member: NF }],
  ["P27", "招待リンク（有効・未ログインでも開ける）", `/invite/${ids.inviteToken}`, { anon: OK, admin: OK }],
  ["P28", "招待リンク（期限切れ）", "/invite/test-invite-expired", { anon: OK }],
  ["P29", "招待リンク（取り消し済み）", "/invite/test-invite-revoked", { anon: OK }],
  ["P30", "招待リンク（存在しない）", "/invite/does-not-exist", { anon: OK }],
];

const rows = [];
for (const [id, label, path, expects] of cases) {
  for (const [role, expected] of Object.entries(expects)) {
    const cookie = cookies[role];
    const res = await fetch(BASE + path, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });

    let actual = String(res.status);
    let note = "";

    if (res.status >= 300 && res.status < 400) {
      actual = `307:${(res.headers.get("location") ?? "").replace(BASE, "").split("?")[0]}`;
    } else {
      const body = await res.text();
      const notFoundShown = res.status === 404 || body.includes("NEXT_NOT_FOUND");
      if (res.status === 200) {
        actual = notFoundShown ? "200（not-found画面）" : "200";
        if (body.includes("問題が発生しました") || body.includes("Application error")) {
          note = "エラーバウンダリが表示された";
        }
      }
      if (expected === NF) {
        // ステータスが404でも、ストリーミングで200＋not-found画面でも「見えない」で合格
        actual = notFoundShown ? NF : `見えている（${res.status}）`;
      }
    }

    rows.push({
      id: `${id}/${role}`,
      item: `${label}（${role}）`,
      expected: String(expected),
      actual,
      ok: actual === String(expected) && note === "",
      note,
    });
  }
}

const summary = writeResults("pages", "P: ページの到達性と権限", rows);
console.table(rows.filter((r) => !r.ok));
process.exitCode = summary.failed > 0 ? 1 : 0;
