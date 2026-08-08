import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";

// VercelなどHTTPSホスティング環境で発生する「State cookie was missing」対策。
// NEXTAUTH_URLがhttpsならセキュアCookie（__Secure-/__Host-プレフィックス）を明示的に使う。
// 本来はnext-auth側の自動判定に任せられるはずだが、Vercel上でこの自動判定が
// うまく効かないケースがあったため明示指定する。ローカル開発(http)では通常のCookie名になる。
const useSecureCookies = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const cookiePrefix = useSecureCookies ? "__Secure-" : "";
const hostPrefix = useSecureCookies ? "__Host-" : "";

// Claude/ローカル動作確認用の開発専用ログイン経路。ログイン画面のUIには一切出さず、
// /api/auth/callback/dev-login を直接叩いた場合のみ機能する。
// NODE_ENV!=="production" かつ ENABLE_DEV_LOGIN==="true" の両方を満たさない限り
// providersに追加されないため、Vercel本番環境ではこの値をtrueにしても常に無効（二重ガード）。
// ENABLE_DEV_LOGINはローカル.env専用。本格リリース後はこのブロックごと削除してよい。
const DEV_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_LOGIN === "true";
const DEV_TEST_USER_EMAIL = "dev-test@sharestaq.local";

async function ensureDevTestAccount() {
  const user = await db.user.upsert({
    where: { email: DEV_TEST_USER_EMAIL },
    update: {},
    create: {
      email: DEV_TEST_USER_EMAIL,
      name: "テストユーザー（開発専用）",
      provider: "dev-login",
    },
  });

  const hasGroup = await db.group.findFirst({ where: { ownerId: user.id } });
  if (!hasGroup) {
    await db.group.create({
      data: { name: "テスト用グループ（開発専用）", ownerId: user.id },
    });
  }

  return user;
}

const providers: NextAuthOptions["providers"] = [
  DiscordProvider({
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    checks: ["pkce", "state"],
  }),
];

if (DEV_LOGIN_ENABLED) {
  providers.push(
    CredentialsProvider({
      id: "dev-login",
      name: "開発用テストログイン",
      credentials: {},
      async authorize() {
        const user = await ensureDevTestAccount();
        return { id: user.id, email: user.email, name: user.name, image: user.avatarUrl };
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}next-auth.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: `${cookiePrefix}next-auth.callback-url`,
      options: { sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    csrfToken: {
      name: `${hostPrefix}next-auth.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    pkceCodeVerifier: {
      name: `${cookiePrefix}next-auth.pkce.code_verifier`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies, maxAge: 900 },
    },
    state: {
      name: `${cookiePrefix}next-auth.state`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies, maxAge: 900 },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login", // 許可リスト外の場合もここに戻す（?error=AccessDenied が付与される）
  },
  callbacks: {
    // クローズドな友人グループ運用のため、許可リストに無いアカウントはログイン自体を拒否する。
    // Discordでログインした場合は discordUserId、それ以外はメールアドレスで照合する。
    async signIn({ user, account }) {
      // 開発用ログインはprovider自体がNODE_ENV/ENABLE_DEV_LOGINの二重ガード付きのため、
      // 許可リストチェックは通さない（テスト専用アカウントなので許可リスト登録も不要にする）。
      if (DEV_LOGIN_ENABLED && account?.provider === "dev-login") {
        return true;
      }

      const discordUserId =
        account?.provider === "discord" ? account.providerAccountId : undefined;

      const allowed = await db.allowlistEntry.findFirst({
        where: {
          OR: [
            discordUserId ? { discordUserId } : undefined,
            user.email ? { email: user.email } : undefined,
          ].filter(Boolean) as { discordUserId?: string; email?: string }[],
        },
      });

      if (!allowed) {
        console.warn(`[auth] blocked sign-in attempt: ${user.email ?? discordUserId}`);
        return false; // NextAuthが /login?error=AccessDenied にリダイレクトする
      }

      // Discordでログインした場合、Botとの連携用にdiscordUserIdを永続化する。
      // これがないと、Discord Bot経由の投稿を「誰の投稿か」判定できない。
      if (discordUserId) {
        await db.user.upsert({
          where: { email: user.email ?? "" },
          update: { discordUserId },
          create: {
            email: user.email ?? undefined,
            name: user.name,
            avatarUrl: user.image,
            provider: "discord",
            discordUserId,
          },
        });
      }
      return true;
    },
    async session({ session, token }) {
      // TODO: session.user.id にDBのUser.idを詰める
      return session;
    },
  },
  session: { strategy: "jwt" },
};
