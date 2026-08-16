// NextAuthのセッションJWTを直接発行する。本番ビルドでは dev-login が無効なため、
// Cookie（next-auth.session-token）を自分で作ってブラウザに食わせる。
//
// 使い方: node tools/local-test/make-token.mjs <email> [name]
//   --legacy を付けると userId を入れない「古い形」のトークンを作る。
//   セッションにIDが入る前に発行されたトークンでも動くこと（getCurrentUser の
//   DBフォールバック）を確認するのに使う。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2).filter((a) => a !== "--legacy");
const legacy = process.argv.includes("--legacy");
const [email, name] = args;
const secret = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

let userId;
if (!legacy) {
  const db = new PrismaClient();
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  userId = user?.id;
  await db.$disconnect();
}

const token = await encode({
  token: {
    name: name ?? email,
    email,
    picture: null,
    sub: email,
    // 本番では lib/auth.ts の jwt コールバックがサインイン時に載せる
    ...(userId ? { userId } : {}),
  },
  secret,
  maxAge: 60 * 60,
});

process.stdout.write(token);
