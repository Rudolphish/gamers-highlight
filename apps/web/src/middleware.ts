import { withAuth } from "next-auth/middleware";

// **許可リストから外されて締め出された人（token.revoked）も通さない。**
// 見直し自体は lib/auth.ts の jwt コールバックで1時間ごとに行い、結果をトークンに書き込む。
export default withAuth({
  callbacks: {
    authorized: ({ token }) => Boolean(token) && !token?.revoked,
  },
});

// (main)配下（ホーム、グループ、アルバム、アップロード、マニュアル、設定など）はすべて要ログイン。
// (auth)配下（ログイン画面）とAPI Routes、静的アセットは対象外。
//
// ここに列挙し漏れたパスは未ログインでも描画まで進んでしまう。
// 実際に /groups と /manual が漏れており、/groups/new は未ログインでも作成フォームが出て、
// /groups/[groupId]/albums/new は500になっていた（APIは別途認証しているので情報は漏れないが、
// 画面としては壊れている）。(main)配下を追加したらここにも足すこと。
export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/albums/:path*",
    "/groups/:path*",
    "/manual/:path*",
    "/me/:path*",
    "/search/:path*",
    "/upload/:path*",
    "/settings/:path*",
  ],
};
