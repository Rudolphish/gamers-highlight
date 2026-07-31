import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";

const nextAuthUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
if (!process.env.NEXTAUTH_URL && nextAuthUrl) {
  process.env.NEXTAUTH_URL = nextAuthUrl;
}

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login", // 許可リスト外の場合もここに戻す（?error=AccessDenied が付与される）
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
};
