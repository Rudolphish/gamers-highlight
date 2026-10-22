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

  // pnpmモノレポのルート（lockfile のある所）。file tracing がここを起点に `packages/db` などを拾う。
  //
  // **Next.js 14 の間はこの行は無視されていた**（14 では `experimental` の下が正しく、トップレベルに
  // 昇格したのは 15）。それでも動いていたのは、Next.js が lockfile を辿って同じルートを自動で判定していたから。
  // 15 に上げてこの行が初めて効くようになったが、指している先は自動判定と同じなので、
  // 行の有無でトレースの結果は変わらない（15 に上げたときに、行あり・なしのビルドの
  // `.next/standalone` と `*.nft.json` を突き合わせて確かめた）。
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Prisma公式が推奨する設定：Prisma Clientをwebpackバンドル対象から除外し、
  // node_modules経由でそのまま読み込ませる。
  // （Next.js 14 では `experimental.serverComponentsExternalPackages` という名前だった）
  serverExternalPackages: ["@prisma/client", "@gamers-highlight/db"],
  experimental: {
    // 一度開いたページに30秒以内に戻ったときは、サーバーへ行かずにブラウザの記憶から出す。
    // **Next.js 14 の既定がこれ（dynamic: 30）で、15 から0秒になった。** 指定しないと、タブを
    // 行き来するたびにサーバーへ取りに行くようになり、体感が遅くなる（15 に上げたときに実測:
    // `/groups` → `/albums` → `/groups` → `/albums` で、14 の形は2回目以降0件、15 の既定は毎回1件）。
    // 14 のときと同じ動きに戻すだけなので、30秒の間に古い表示が出うる場面も 14 のときと変わらない。
    // 詳しくは docs/perf-cache.md
    staleTimes: { dynamic: 30 },
  },
};

module.exports = nextConfig;
