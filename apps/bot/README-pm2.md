# Botの常駐運用（PM2）

このPCにログインしたタイミングでPM2が自動的にBotを起動する設定になっている
（`pm2-startup install`済み、`pm2 save`でプロセス一覧を保存済み）。

## よく使うコマンド

- `pnpm --filter bot pm2:start` … ビルドしてPM2にBotを登録・起動
- `pnpm --filter bot pm2:restart` … コード変更後、再ビルドして再起動（コード修正時はこれを使う）
- `pnpm --filter bot pm2:stop` … 一時停止
- `pnpm --filter bot pm2:logs` … ログをリアルタイム表示（Ctrl+Cで終了）
- `pm2 status` … 稼働状況の一覧
- `pm2 save` … 現在のプロセス一覧を保存し直す（新しいアプリをPM2管理下に追加した時などに実行）

## 注意点

- `apps/bot/src/commands/tag.ts`のようなコマンド定義を変更した場合、
  `pnpm --filter bot deploy-commands`を別途実行してDiscordにコマンドを再登録する必要がある
  （PM2の再起動だけでは反映されない）
- コード変更を反映するには`pm2:restart`（再ビルド＋再起動）を使うこと。
  `pm2 restart`だけだとビルド前の古いdist/index.jsのまま再起動されてしまう
