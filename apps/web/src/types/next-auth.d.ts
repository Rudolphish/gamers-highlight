import "next-auth";

declare module "next-auth/jwt" {
  interface JWT {
    /** DBの User.id。サインイン時に1回だけ引いてトークンに載せる（lib/auth.ts の jwt コールバック） */
    userId?: string;
  }
}

declare module "next-auth" {
  interface Session {
    user?: {
      /**
       * DBの `User.id`。
       *
       * これが無かった頃は、全ページ・全APIの先頭で毎回
       * `db.user.findUnique({ where: { email } })` を実行してidを解決していた。
       * 他の判定すべての前段にあるため必ず直列に待つ1往復で、本番（Vercel→Supabase）では
       * そのぶんが全ページに乗っていた。
       *
       * **取得は `lib/currentUser.ts` の `getCurrentUser()` を使うこと。**
       * ここを直接読むと、idを載せる前に発行されたトークンで undefined になる。
       */
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /**
       * 許可リストを編集できる管理者かどうか（lib/admin.ts の ADMIN_EMAILS 判定）。
       * 表示の出し分け専用。実際の権限チェックは常にサーバー側で行う。
       */
      isAdmin?: boolean;
    };
  }
}
