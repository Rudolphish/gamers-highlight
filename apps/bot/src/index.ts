import "./env.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleMessageCreate } from "./handlers/messageCreate.js";
import * as tagCommand from "./commands/tag.js";

const commands = new Map([[tagCommand.data.name, tagCommand]]);

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

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  command.execute(interaction).catch((err) => {
    console.error(`[bot] failed to handle /${interaction.commandName}`, err);
  });
});

client.login(process.env.DISCORD_BOT_TOKEN);
