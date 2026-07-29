export { default } from "next-auth/middleware";

// (main)配下（ホーム、アルバム、アップロード、設定など）はすべて要ログイン。
// (auth)配下（ログイン画面）とAPI Routes、静的アセットは対象外。
export const config = {
  matcher: [
    "/",
    "/albums/:path*",
    "/search/:path*",
    "/upload/:path*",
    "/settings/:path*",
  ],
};
