// アルバム詳細ページの権限マトリクス。
//
// **ステータスだけを見てはいけない。** `loading.tsx` があるルートはNext.jsが
// ストリーミングを始めてヘッダーを先に送るため、ページ関数が後から notFound() しても
// HTTPステータスは200のまま、本文の途中でnot-found画面に差し替わる。
// 見たいのは「中身が出ていないこと」なので、本文で判定する。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

const album = await db.album.findFirst({ where: { title: "エルデンリング" } });
const otherAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });

async function open(email, albumId, secretText) {
  const token = await encode({ token: { name: email, email, sub: email }, secret: SECRET, maxAge: 3600 });
  const res = await fetch(`${BASE}/albums/${albumId}`, {
    headers: { cookie: `next-auth.session-token=${token}` },
    redirect: "manual",
  });
  const html = await res.text();
  return {
    status: res.status,
    // そのアルバム固有の文字列が出ているかどうかが本題
    visible: secretText ? html.includes(secretText) : false,
    notFoundShown: res.status === 404 || html.includes("NEXT_NOT_FOUND"),
  };
}

// [説明, 誰が, どれを, そのアルバム固有の文字列, 見えるべきか]
const cases = [
  ["アルバムのオーナー（admin）→ 自グループのアルバム", "admin@example.com", album.id, "エルデンリング", true],
  ["アルバムのメンバー（member）→ 自グループのアルバム", "member@example.com", album.id, "エルデンリング", true],
  ["部外者 → 他人のグループのアルバム", "outsider@example.com", album.id, "エルデンリング", false],
  ["admin → 部外者のアルバム", "admin@example.com", otherAlbum.id, "部外者のアルバム", false],
  ["member → 部外者のアルバム", "member@example.com", otherAlbum.id, "部外者のアルバム", false],
  ["部外者 → 自分のアルバム", "outsider@example.com", otherAlbum.id, "部外者のアルバム", true],
  ["存在しないアルバム", "admin@example.com", "does-not-exist", null, false],
];

const rows = [];
for (const [label, email, albumId, secretText, shouldSee] of cases) {
  const r = await open(email, albumId, secretText);
  const ok = shouldSee ? r.visible : !r.visible && r.notFoundShown;
  rows.push({
    結果: ok ? "OK" : "NG",
    内容: label,
    期待: shouldSee ? "中身が見える" : "中身が見えない",
    実際: r.visible ? "見える" : r.notFoundShown ? "not-found画面" : "空",
    ステータス: r.status,
  });
}

console.table(rows);
const ng = rows.filter((r) => r.結果 === "NG").length;
console.log(`NG ${ng} 件`);
await db.$disconnect();
process.exitCode = ng > 0 ? 1 : 0;
