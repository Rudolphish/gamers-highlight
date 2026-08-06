// PM2用のプロセス定義。ビルド済みの dist/index.js をPM2に管理させ、
// クラッシュ時の自動再起動・PC再起動後の自動起動を可能にする。
// 使い方は apps/bot/README-pm2.md 参照。
module.exports = {
  apps: [
    {
      name: "gamers-highlight-bot",
      cwd: __dirname,
      script: "dist/index.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
