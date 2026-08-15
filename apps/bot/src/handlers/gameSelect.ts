import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type Message,
} from "discord.js";
import { fetchGroupGames, assignGame } from "../lib/apiClient.js";

/**
 * ゲームが判別できなかった投稿に「どのゲーム？」と聞く。
 *
 * 普段の使い方（Steamのスクショをクリップボードから貼る）ではファイル名に
 * 手掛かりが何も残らないため、ファイル名からの判別は発火しない。
 * その場合にここで拾う。
 *
 * 添付が複数あっても**メッセージごとに1回だけ聞く**（選択は同じメッセージの
 * 未分類の投稿すべてに反映される）。
 */

/** customIdは `pickgame:<メッセージID>` の形で、どの投稿への回答かを持たせる */
const PREFIX = "pickgame";

export function isGameSelect(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

/** 未分類の投稿に対して、グループのゲーム一覧から選ばせる */
export async function askForGame(message: Message) {
  if (!message.guildId) return;

  const games = await fetchGroupGames(message.guildId);
  // 選択肢が無ければ聞くだけ無駄なので黙っておく（/tag や画面から後で付けられる）
  if (games.length === 0) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:${message.id}`)
    .setPlaceholder("ゲームを選ぶ")
    .addOptions(
      games.map((g) => ({
        // Discordの制限に合わせて切り詰める（ラベルは100文字まで）
        label: g.title.slice(0, 100),
        value: String(g.steamAppId),
      }))
    );

  await message.reply({
    content: "どのゲームのスクショ？（選ばなくても投稿は保存されています）",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    allowedMentions: { repliedUser: false },
  });
}

export async function handleGameSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;

  const messageId = interaction.customId.slice(PREFIX.length + 1);
  const steamAppId = Number(interaction.values[0]);
  if (!Number.isInteger(steamAppId)) return;

  // Web側の応答がDiscordの3秒制限を超えることがあるので先に猶予を取る
  await interaction.deferReply({ ephemeral: true });

  const result = await assignGame({
    guildId: interaction.guildId,
    messageId,
    discordUserId: interaction.user.id,
    steamAppId,
  });

  if (!result.ok || !result.updated) {
    // 投稿者以外が選んだ場合もここに来る（Web側で投稿者のものだけを更新している）
    await interaction.editReply(
      "反映できませんでした。自分が投稿したスクショにだけ設定できます。"
    );
    return;
  }

  await interaction.editReply(`「${result.gameTitle}」に設定しました（${result.updated}件）`);

  // 用が済んだ問いかけは残さない。チャンネルが問いかけで埋まると邪魔になる
  await interaction.message.delete().catch(() => {});
}
