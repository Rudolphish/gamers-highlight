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
};

module.exports = nextConfig;
