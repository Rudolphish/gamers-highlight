// 再現: グループにもアルバムにも属していないログインユーザーが、
// URLを知っているだけでアルバム詳細ページ（写真・メンバー名）を見られる。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

const otherAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });
const token = await encode({
  token: { name: "管理者ユーザー", email: "admin@example.com", sub: "admin@example.com" },
  secret: SECRET,
  maxAge: 3600,
});

const res = await fetch(`${BASE}/albums/${otherAlbum.id}`, {
  headers: { cookie: `next-auth.session-token=${token}` },
  redirect: "manual",
});
const html = await res.text();

const leakedTitle = html.includes("部外者のアルバム");
const leakedPhoto = html.includes("outsider.png");

console.log(`ステータス          : ${res.status}`);
console.log(`アルバム名が見える  : ${leakedTitle}`);
console.log(`写真が見える        : ${leakedPhoto}`);
console.log(
  res.status === 404 && !leakedTitle && !leakedPhoto
    ? "\n判定: OK（404で弾かれる）"
    : "\n判定: NG（権限の無いアルバムの中身が見えている）"
);

// APIは正しく403を返すこと（ページだけの問題であることの確認）
const api = await fetch(`${BASE}/api/albums/${otherAlbum.id}`, {
  headers: { cookie: `next-auth.session-token=${token}` },
});
console.log(`参考: GET /api/albums/:id = ${api.status}（APIは以前から403）`);

await db.$disconnect();
