import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleMessageCreate } from "./handlers/messageCreate.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, (message) => {
  handleMessageCreate(message).catch((err) => {
    console.error("[bot] failed to handle message", err);
  });
});

// TODO: スラッシュコマンド（/tag等）のインタラクションハンドラ登録
// client.on(Events.InteractionCreate, ...)

client.login(process.env.DISCORD_BOT_TOKEN);
