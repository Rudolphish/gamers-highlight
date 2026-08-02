const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**", // TODO: R2/S3の公開ドメインに絞り込む
      },
    ],
  },
  // pnpmモノレポ構成でPrisma Client（packages/db/generated、カスタムoutput）を
  // Vercelのサーバーレス関数バンドルに正しく含めるための設定。
  // これが無いとNext.jsのfile tracingがモノレポのルートを誤認識し、
  // 実行時に「Could not open datamodel file」で失敗することがある。
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    // Prisma Client（クエリエンジンのバイナリ・schema.prismaへの相対パス参照を内部に持つ）を
    // Next.jsのwebpackバンドル対象から除外し、node_modules経由でそのまま読み込ませる。
    // バンドルされてchunkファイルに移動されると、Prisma内部の相対パス計算が壊れて
    // 「Could not open datamodel file」エラーの原因になるため。
    serverComponentsExternalPackages: ["@prisma/client", "@gamers-highlight/db"],
  },
};

module.exports = nextConfig;
