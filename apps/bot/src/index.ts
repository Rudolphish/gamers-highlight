import "./env.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { handleMessageCreate } from "./handlers/messageCreate.js";
import * as tagCommand from "./commands/tag.js";
import {
  isGameSelect,
  handleGameSelect,
  isGameModal,
  handleGameModal,
  isGameButton,
  handleGameButton,
} from "./handlers/gameSelect.js";
import { sendHeartbeat } from "./lib/apiClient.js";
import { catchUpMissedMessages } from "./lib/catchUp.js";

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15分おき

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

  // **起動時の生存報告は「更新前の時刻」を返す**＝自分が最後に生きていた時刻。
  // それを起点に、落ちていた間の投稿を遡って取り込む（lib/catchUp.ts）。
  // 失敗してもBot本体は動かす——取りこぼしの回収より、いま来る投稿の方が大事
  sendHeartbeat()
    .then(({ previousSeenAt }) => catchUpMissedMessages(c, previousSeenAt))
    .then((result) => {
      if (!result.since) {
        console.log(`[catchup] 遡らなかった: ${result.reason}`);
        return;
      }
      console.log(
        `[catchup] ${result.since.toISOString()} 以降を確認: ` +
          `${result.scannedChannels}チャンネル / 対象${result.matchedMessages}件 / ` +
          `添付${result.ingestedAttachments}件を取り込みへ渡した`
      );
    })
    .catch((err) => console.error("[catchup] 遡り取り込みに失敗", err));

  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
});

client.on(Events.MessageCreate, (message) => {
  handleMessageCreate(message).catch((err) => {
    console.error("[bot] failed to handle message", err);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isStringSelectMenu() && isGameSelect(interaction.customId)) {
    handleGameSelect(interaction).catch((err) => {
      console.error("[bot] failed to handle game select", err);
    });
    return;
  }

  if (interaction.isModalSubmit() && isGameModal(interaction.customId)) {
    handleGameModal(interaction).catch((err) => {
      console.error("[bot] failed to handle game modal", err);
    });
    return;
  }

  if (interaction.isButton() && isGameButton(interaction.customId)) {
    handleGameButton(interaction).catch((err) => {
      console.error("[bot] failed to handle game button", err);
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  command.execute(interaction).catch((err) => {
    console.error(`[bot] failed to handle /${interaction.commandName}`, err);
  });
});

client.login(process.env.DISCORD_BOT_TOKEN);
