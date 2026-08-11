import "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
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
