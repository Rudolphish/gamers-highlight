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
  // pnpmモノレポ構成でNext.jsのfile tracingがモノレポのルートを正しく認識するための設定。
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    // Prisma公式が推奨する設定：Prisma Clientをwebpackバンドル対象から除外し、
    // node_modules経由でそのまま読み込ませる。
    serverComponentsExternalPackages: ["@prisma/client", "@gamers-highlight/db"],
  },
};

module.exports = nextConfig;
