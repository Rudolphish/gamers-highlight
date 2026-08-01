import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";

const isVercel = Boolean(process.env.VERCEL);
const isSecureEnv = process.env.NODE_ENV === "production" || isVercel;
const nextAuthUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
if (nextAuthUrl) {
  process.env.NEXTAUTH_URL = nextAuthUrl;
  process.env.AUTH_URL = nextAuthUrl;
}

const cookieSameSite = process.env.NEXT_PUBLIC_NEXTAUTH_COOKIE_SAMESITE || (isSecureEnv ? "none" : "lax");
const cookieOptions = {
  path: "/",
  sameSite: cookieSameSite as "lax" | "none" | "strict",
  secure: isSecureEnv,
};
const providers = [];
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const nextAuthSecret = process.env.NEXTAUTH_SECRET;

if (discordClientId && discordClientSecret) {
  providers.push(
    DiscordProvider({
      clientId: discordClientId,
      clientSecret: discordClientSecret,
    }),
  );
}

if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  );
}

if (!nextAuthSecret) {
  throw new Error("NEXTAUTH_SECRET is required for NextAuth.");
}

if (providers.length === 0) {
  throw new Error("NextAuth requires at least one OAuth provider to be configured. Set DISCORD_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET.");
}

export const authOptions = {
  trustHost: true,
  useSecureCookies: isSecureEnv,
  providers,
  secret: nextAuthSecret,
  cookies: {
    csrfToken: {
      name: "next-auth.csrf-token",
      options: {
        httpOnly: false,
        ...cookieOptions,
      },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: {
        ...cookieOptions,
      },
    },
    state: {
      name: isSecureEnv ? "__Secure-next-auth.state" : "next-auth.state",
      options: {
        httpOnly: true,
        ...cookieOptions,
      },
    },
    pkceCodeVerifier: {
      name: isSecureEnv ? "__Secure-next-auth.pkce.code_verifier" : "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        ...cookieOptions,
      },
    },
    sessionToken: {
      name: isSecureEnv ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        ...cookieOptions,
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login", // 許可リスト外の場合もここに戻す（?error=AccessDenied が付与される）
  },
  logger: {
    error(code, metadata) {
      console.error(`[next-auth] error: ${code}`, metadata);
    },
    warn(code) {
      console.warn(`[next-auth] warn: ${code}`);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development") {
        console.debug(`[next-auth] debug: ${code}`, metadata);
      }
    },
  },
  callbacks: {
    // クローズドな友人グループ運用のため、許可リストに無いアカウントはログイン自体を拒否する。
    // Discordでログインした場合は discordUserId、それ以外(Google等)はメールアドレスで照合する。
    async signIn({ user, account }) {
      const discordUserId = account?.provider === "discord" ? account.providerAccountId : undefined;

      const allowed = await db.allowlistEntry.findFirst({
        where: {
          OR: [discordUserId ? { discordUserId } : undefined, user.email ? { email: user.email } : undefined].filter(Boolean) as {
            discordUserId?: string;
            email?: string;
          }[],
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
} as NextAuthOptions & {
  trustHost: boolean;
  useSecureCookies: boolean;
};
