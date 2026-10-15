const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2の公開ドメイン（pub-*.r2.dev）と、ストレージのエンドポイント。
      {
        protocol: "https",
        hostname: "pub-*.r2.dev",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
      // YouTubeのサムネイル。動画IDから組み立てられる公開のURLで、ハッシュ等は入らない。
      // **ここに足し忘れると next/image が400で弾き、「サムネイルだけ出ない」になる**
      // （URL自体は正しいので原因が分かりにくい。Steamのヘッダー画像で同じことを踏んだ）。
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      // Steamストアのゲームカバー/サムネイル（cdn.akamai.steamstatic.com等、複数のサブドメインを使うためワイルドカード）
      {
        protocol: "https",
        hostname: "*.steamstatic.com",
      },
      // appdetailsのheader_imageは古いタイトルでこのドメインを返すことがある。
      // 許可されていないホストのURLはnext/imageが400 ("url" parameter is not allowed)で弾き、
      // 保存されているURL自体は正しいのに画像だけ出ないという分かりにくい壊れ方をする。
      {
        protocol: "https",
        hostname: "*.akamaihd.net",
      },
      // Discordのユーザーアバター
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
      // ストレージ未設定時（ローカル開発のフォールバック）のモック画像
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  output: "standalone",

  // 全ページ・全APIに付けるセキュリティヘッダー。
  // - 他のサイトの iframe に埋め込ませない（透明に重ねて「削除」などを押させるクリックジャッキング対策。
  //   古いブラウザ向けの X-Frame-Options と、CSP の frame-ancestors の両方を出す）
  // - Content-Type を推測させない（アップロードされたファイルが別の種類として解釈されないように）
  // - 他サイトへ遷移するときに URL のパス（アルバムIDなど）を Referer で渡さない
  // - 使っていない端末の機能（カメラ・マイク・位置情報）を明示的に切る
  //
  // **CSP は frame-ancestors だけにしている。** script-src まで絞ると Next.js が埋め込む
  // インラインスクリプトに nonce が要り、ページが白くなる壊れ方をする（確かめる手段がローカルの本番ビルドしかない）。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },

  // **この位置の outputFileTracingRoot は Next.js 14 では無視される**
  // （14 では `experimental` の下が正しい。トップレベルに昇格したのは 15）。
  // ビルドと起動のたびに `Unrecognized key(s) in object: 'outputFileTracingRoot'` が出るのはこれ。
  //
  // それでも直していないのは、**無視されたままで意図どおりに動いているから**。
  // pnpmモノレポでfile tracingがルートを取り違えると `packages/db` が漏れるが、
  // 実際の `.next/standalone` には `packages/db` も `apps/web/server.js` も入っている
  // （Next.jsがlockfileを辿って自動でモノレポのルートを正しく判定している）。
  // つまりこの設定が防ごうとしていた問題は起きていない。
  //
  // ここを `experimental` の下へ移すと、**プロジェクトで初めてこの設定が有効になる**。
  // 良くて現状維持、悪くて追跡範囲が変わってデプロイ成果物が変わる。しかもVercelは
  // 自前のビルド出力を使うので、ローカルで同じものを確認できない。得るものが警告1行の
  // 消滅なのに対して、壊れたときは本番に出るまで分からない。だから触らない。
  //
  // Next.js 15 に上げるときは注意すること。**上げた瞬間にこの行が有効になる。**
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    // Prisma公式が推奨する設定：Prisma Clientをwebpackバンドル対象から除外し、
    // node_modules経由でそのまま読み込ませる。
    serverComponentsExternalPackages: ["@prisma/client", "@gamers-highlight/db"],
  },
};

module.exports = nextConfig;
