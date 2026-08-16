// 修正後の確認: 権限のある人は今までどおり見え、無い人は404になること。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

const album = await db.album.findFirst({ where: { title: "エルデンリング" } });
const otherAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });

async function get(email, albumId) {
  const token = await encode({ token: { name: email, email, sub: email }, secret: SECRET, maxAge: 3600 });
  const res = await fetch(`${BASE}/albums/${albumId}`, {
    headers: { cookie: `next-auth.session-token=${token}` },
    redirect: "manual",
  });
  const html = await res.text();
  return { status: res.status, hasContent: html.includes("エルデンリング") || html.includes("部外者のアルバム") };
}

const cases = [
  ["アルバムのオーナー（admin）→ 自グループのアルバム", "admin@example.com", album.id, 200],
  ["アルバムのメンバー（member）→ 自グループのアルバム", "member@example.com", album.id, 200],
  ["部外者 → 他人のグループのアルバム", "outsider@example.com", album.id, 404],
  ["admin → 部外者のアルバム", "admin@example.com", otherAlbum.id, 404],
  ["member → 部外者のアルバム", "member@example.com", otherAlbum.id, 404],
  ["部外者 → 自分のアルバム", "outsider@example.com", otherAlbum.id, 200],
  ["存在しないアルバム", "admin@example.com", "does-not-exist", 404],
];

const rows = [];
for (const [label, email, albumId, expected] of cases) {
  const r = await get(email, albumId);
  rows.push({ 結果: r.status === expected ? "OK" : "NG", 内容: label, 期待: expected, 実際: r.status, 中身が出る: r.hasContent });
}
console.table(rows);
console.log(`NG ${rows.filter((r) => r.結果 === "NG").length} 件`);
await db.$disconnect();
