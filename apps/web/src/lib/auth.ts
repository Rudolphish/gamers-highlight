import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";
import { isAdminEmail } from "./admin";
import { registerAllowlistFromInvite } from "./groupInvites";
import { isStillAllowed, linkDiscordUser } from "./discordAccount";
import { logAuthError } from "./authErrorLog";
import { resolveThemeColor } from "./themeColors";

/**
 * ログイン中の人が、いまも許可リストに載っているかを見直す間隔。
 * 許可リストから外された人は、遅くともこの時間で締め出される（lib/discordAccount.ts の isStillAllowed）
 */
const ALLOWLIST_RECHECK_MS = 60 * 60 * 1000;

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
    // **発行元を書いておかないと、戻り先のURLに `iss` が付いた回だけログインが失敗する。**
    // Discord はログインから戻すURLに `iss`（RFC 9207）を付けるようになった（2026-10 時点で段階的に）。
    // openid-client は `iss` があると発行元と照合し、発行元が未設定だと
    // 「issuer must be configured on the issuer」で落ちる。NextAuth 組み込みの Discord 設定には
    // 発行元が無い（next-auth #12694 で議論中）。2026-10-15 に Mac の Chrome だけ2回続けて失敗した
    // （/admin/errors に記録された理由で判明）。`iss` が付かない回は従来どおり通る
    issuer: "https://discord.com",
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
    async signIn({ user, account, profile }) {
      // 開発用ログインはprovider自体がNODE_ENV/ENABLE_DEV_LOGINの二重ガード付きのため、
      // 許可リストチェックは通さない（テスト専用アカウントなので許可リスト登録も不要にする）。
      if (DEV_LOGIN_ENABLED && account?.provider === "dev-login") {
        return true;
      }

      const discordUserId =
        account?.provider === "discord" ? account.providerAccountId : undefined;
      // Discord のアカウントはメール未確認のまま使える。未確認のアドレスは照合にも保存にも使わない
      // （lib/discordAccount.ts の説明を参照）
      const emailVerified =
        account?.provider !== "discord" || (profile as { verified?: boolean } | undefined)?.verified === true;

      // 招待リンク経由の初回ログインだけ、許可リストへの登録を代行する。
      // **下の許可リスト判定には手を触れていない。** ここは AllowlistEntry を作るだけで、
      // 有効な招待Cookieが無ければ何もしないため、通常のログインの挙動は変わらない
      // （登録されなければ従来どおり下の判定で弾かれる）。
      if (discordUserId) {
        await registerAllowlistFromInvite(discordUserId);
      }

      const allowed = await db.allowlistEntry.findFirst({
        where: {
          OR: [
            discordUserId ? { discordUserId } : undefined,
            emailVerified && user.email ? { email: user.email } : undefined,
          ].filter(Boolean) as { discordUserId?: string; email?: string }[],
        },
      });

      if (!allowed) {
        console.warn(`[auth] blocked sign-in attempt: ${user.email ?? discordUserId}`);
        return false; // NextAuthが /login?error=AccessDenied にリダイレクトする
      }

      // Discordでログインした場合、Botとの連携用にdiscordUserIdを永続化する。
      // これがないと、Discord Bot経由の投稿を「誰の投稿か」判定できない。
      // **鍵は Discord のユーザーID**（以前はメールアドレスで upsert しており、乗っ取りの筋があった）
      if (discordUserId) {
        const linked = await linkDiscordUser({
          discordUserId,
          email: user.email ?? null,
          emailVerified,
          name: user.name ?? null,
          image: user.image ?? null,
        });
        if (!linked.ok) {
          console.warn(`[auth] blocked sign-in: ${linked.reason} discordUserId=${discordUserId}`);
          return false;
        }
      }
      return true;
    },
    /**
     * DBの User.id をトークンに載せる。**サインイン時に1回だけ**引く。
     *
     * これが無かったときは、全ページ・全APIの先頭で毎回
     * `db.user.findUnique({ where: { email } })` を実行してidを解決していた（57箇所）。
     * 他の判定すべての前段にあるため必ず直列に待つ1往復で、本番（Vercel→Supabase）では
     * そのぶんが全ページに乗っていた。
     *
     * `user` が入るのはサインインの回だけで、以降の呼び出しでは token をそのまま返すため、
     * ここでDBを引き続けることはない。
     *
     * **これは権限判定ではない。** 許可リストから外してもUserレコードは消さない運用
     * （`/api/allowlist/:id` のコメント参照）なので、毎回引いていた頃も
     * 「存在するか」を見ていただけで、締め出しの役には立っていなかった。
     */
    async jwt({ token, user, account, trigger }) {
      // サインインの回。Discord なら Discord のユーザーIDで行を引く（メールアドレスでは引かない）。
      // **token.email も DB の値で上書きする。** 管理者の判定（isAdminEmail）はこのメールを見るので、
      // Discord から来た未確認のアドレスを使うと、他人のアドレスを名乗って管理者になれてしまう
      if (user) {
        const dbUser =
          account?.provider === "discord"
            ? await db.user.findUnique({ where: { discordUserId: account.providerAccountId }, select: { id: true, email: true, name: true, themeColor: true } })
            : user.email
              ? await db.user.findUnique({ where: { email: user.email }, select: { id: true, email: true, name: true, themeColor: true } })
              : null;
        if (dbUser) {
          token.userId = dbUser.id;
          token.email = dbUser.email;
          // 名前も DB の表示名にする。そのままだと Discord のプロフィールの名前が入り、PCの左下のアカウントと
          // 「自分」ページ（DBの表示名）とで名前が食い違う（プロフィールで名前を変えた人はずっと）
          if (dbUser.name) token.name = dbUser.name;
          // テーマの色もここで載せる。ページごとに DB を引かずに、(main)/layout.tsx が最初の描画からその色で出せる
          token.themeColor = resolveThemeColor(dbUser.themeColor);
        }
        token.devLogin = account?.provider === "dev-login" ? true : undefined;
        token.allowCheckedAt = Date.now();
        token.revoked = undefined;
        return token;
      }

      // idを載せる前に発行されたトークン（使い続けると期限が延びるので今も残りうる）。1回だけ引いて載せる。
      // 下の読み直し（update）より先に置く（id が無いと読み直せないため）
      if (!token.userId && token.email) {
        const dbUser = await db.user.findUnique({ where: { email: token.email }, select: { id: true } });
        if (dbUser) token.userId = dbUser.id;
      }

      // プロフィールで表示名やテーマの色を変えた直後（画面が useSession().update() を呼ぶ）。**DBから読み直す**。
      // update() にはブラウザから好きな値を渡せるので、それをそのままトークンに入れてはいけない
      if (trigger === "update" && token.userId) {
        const fresh = await db.user.findUnique({ where: { id: token.userId }, select: { name: true, themeColor: true } });
        if (fresh?.name) token.name = fresh.name;
        if (fresh) token.themeColor = resolveThemeColor(fresh.themeColor);
      }

      // **許可リストを1時間ごとに見直す。** 外された人は次の見直しで締め出す（開発用ログインは対象外）。
      // 見直した時刻が無い古いトークンは、発行時刻（iat）から数える
      const checkedAt = token.allowCheckedAt ?? (typeof token.iat === "number" ? token.iat * 1000 : 0);
      if (token.userId && !token.devLogin && Date.now() - checkedAt > ALLOWLIST_RECHECK_MS) {
        token.revoked = (await isStillAllowed(token.userId)) ? undefined : true;
        token.allowCheckedAt = Date.now();
        // ついでにテーマの色も読み直す。別の端末で色を変えたとき、こちらの端末も遅くとも1時間で揃う
        // （変えた端末は update() ですぐ変わる）。見直しの回だけなので、ページごとの往復は増えない
        const fresh = await db.user.findUnique({ where: { id: token.userId }, select: { themeColor: true } });
        if (fresh) token.themeColor = resolveThemeColor(fresh.themeColor);
      }
      return token;
    },
    async session({ session, token }) {
      // 締め出された人はログインしていない扱いにする（getCurrentUser も管理者の判定も通らなくなる）
      if (token.revoked) {
        return { ...session, user: undefined };
      }
      if (session.user) {
        // idを載せる前に発行されたトークンにはこれが無い。呼び出し側は
        // lib/currentUser.ts の getCurrentUser() を使い、無ければDBに落とすこと。
        session.user.id = token.userId;

        // 管理者かどうかをセッションに載せておく。設定画面のタブ（クライアント
        // コンポーネント）から出し分けるための表示用フラグで、権限判定そのものは
        // 常にサーバー側（API・ページ）で isAdminEmail を呼んで行う。
        session.user.isAdmin = isAdminEmail(session.user.email);

        // テーマの色（src/lib/themeColors.ts）。テーマを載せる前に発行されたトークンには無いので既定にする
        session.user.themeColor = resolveThemeColor(token.themeColor);
      }
      return session;
    },
  },
  session: { strategy: "jwt" },
  // ログインの失敗の理由を /admin/errors にも残す（画面には分類しか出ず、中身はログにしか無いため。lib/authErrorLog.ts）
  logger: { error: logAuthError },
};
