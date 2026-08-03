const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2の公開ドメイン（pub-*.r2.dev）と、ストレージのエンドポイントのみ許可。
      // ※現在のコードは<img>タグを直接使っておりこの設定は未使用だが、
      // 将来next/imageに切り替える際のために先に絞り込んでおく。
      {
        protocol: "https",
        hostname: "pub-*.r2.dev",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
    ],
  },
  // pnpmモノレポ構成でNext.jsのfile tracingがモノレポのルートを正しく認識するための設定。
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    // Prisma公式が推奨する設定：Prisma Clientをwebpackバンドル対象から除外し、
    // node_modules経由でそのまま読み込ませる。
    serverComponentsExternalPackages: ["@prisma/client", "@gamers-highlight/db"],
  },
};

module.exports = nextConfig;
