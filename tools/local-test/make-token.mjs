// NextAuthのセッションJWTを直接発行する。本番ビルドでは dev-login が無効なため、
// Cookie（next-auth.session-token）を自分で作ってブラウザに食わせる。
// 使い方: node tools/local-test/make-token.mjs <email> <name>
import { encode } from "next-auth/jwt";

const [, , email, name] = process.argv;
const secret = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";

const token = await encode({
  token: {
    name: name ?? email,
    email,
    picture: null,
    sub: email,
  },
  secret,
  maxAge: 60 * 60,
});

process.stdout.write(token);
