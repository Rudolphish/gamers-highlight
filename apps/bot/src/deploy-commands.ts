import "./env.js";
import { REST, Routes } from "discord.js";
import * as tagCommand from "./commands/tag.js";

// スラッシュコマンド定義をDiscord APIに登録する。コマンドを追加/変更した際に一度だけ実行する。
// DISCORD_GUILD_IDが設定されていればそのサーバー限定で即時反映（開発向け）、
// 無ければグローバル登録（反映まで最大1時間ほどかかる）。
const clientId = process.env.DISCORD_CLIENT_ID!;
const guildId = process.env.DISCORD_GUILD_ID;

const commands = [tagCommand.data.toJSON()];

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);

const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });

console.log(
  `[bot] registered ${commands.length} command(s)${guildId ? ` for guild ${guildId}` : " globally"}`
);
