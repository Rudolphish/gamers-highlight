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
};

module.exports = nextConfig;
