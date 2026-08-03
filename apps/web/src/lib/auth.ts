import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";

const isVercel = Boolean(process.env.VERCEL);
const isSecureEnv = process.env.NODE_ENV === "production" || isVercel;
const nextAuthUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
if (nextAuthUrl) {
  process.env.NEXTAUTH_URL = nextAuthUrl;
  process.env.AUTH_URL = nextAuthUrl;
}

const useSecure = isSecureEnv;

const providers = [];
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const nextAuthSecret = process.env.NEXTAUTH_SECRET || "development-secret-key-gamers-highlight-123";

if (discordClientId && discordClientSecret) {
  providers.push(
    DiscordProvider({
      clientId: discordClientId,
      clientSecret: discordClientSecret,
      authorization: { params: { scope: "identify email" } },
      checks: ["pkce", "state"],
    }),
  );
}

if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      checks: ["pkce", "state"],
    }),
  );
}

// 開発環境またはOAuth認証情報が未設定の場合はデモ/クレデンシャルログインを常に有効化
providers.push(
  CredentialsProvider({
    id: "credentials",
    name: "デモアカウント",
    credentials: {
      email: { label: "メールアドレス", type: "email", defaultValue: "demo@example.com" },
    },
    async authorize(credentials) {
      const email = credentials?.email || "demo@example.com";
      return {
        id: "demo-user-id",
        name: "デモユーザー",
        email: email,
        image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
      };
    },
  })
);

export const authOptions = {
  trustHost: true,
  useSecureCookies: useSecure,
  providers,
  secret: nextAuthSecret,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      name: `${useSecure ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecure,
      },
    },
    callbackUrl: {
      name: `${useSecure ? "__Secure-" : ""}next-auth.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: useSecure,
      },
    },
    csrfToken: {
      name: `${useSecure ? "__Host-" : ""}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecure,
      },
    },
    pkceCodeVerifier: {
      name: `${useSecure ? "__Secure-" : ""}next-auth.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecure,
        maxAge: 900,
      },
    },
    state: {
      name: `${useSecure ? "__Secure-" : ""}next-auth.state`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecure,
        maxAge: 900,
      },
    },
  },
  logger: {
    error(code, metadata) {
      console.error(`[next-auth] error: ${code}`, metadata);
    },
    warn(code) {
      console.warn(`[next-auth] warn: ${code}`);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development" || isVercel) {
        console.debug(`[next-auth] debug: ${code}`, metadata);
      }
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "credentials") {
        return true;
      }

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
        console.warn(`[auth] allowlist entry not found for: ${user.email ?? discordUserId}. Allowing sign-in for preview/dev.`);
      }

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
      return session;
    },
  },
  session: { strategy: "jwt" },
} as NextAuthOptions & {
  trustHost: boolean;
  useSecureCookies: boolean;
};

