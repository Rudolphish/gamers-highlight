import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { tagPhoto } from "../lib/apiClient.js";
import { normalizeGameTitleToTag } from "../lib/gameTag.js";

// /tag game:<ゲーム名> … このチャンネルの投稿をチャンネルマッピングと別に
// その場でゲームタグ付けしたい場合のスラッシュコマンド
export const data = new SlashCommandBuilder()
  .setName("tag")
  .setDescription("直前のスクショにゲームタグを付ける")
  .addStringOption((option) =>
    option.setName("game").setDescription("ゲームタイトル").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "サーバー内でのみ使用できます", ephemeral: true });
    return;
  }

  // Web側APIの応答がDiscordの3秒タイムアウトを超えることがあるため、先に一次応答して猶予を確保する
  await interaction.deferReply();

  const gameTitle = interaction.options.getString("game", true);
  const tag = normalizeGameTitleToTag(gameTitle);

  const result = await tagPhoto({
    discordUserId: interaction.user.id,
    guildId: interaction.guildId,
    gameTitle,
    tag,
  });

  if (!result.ok) {
    const message =
      result.status === 404
        ? "直近10分以内のスクショが見つかりませんでした（先に画像/動画を投稿してから使ってください）"
        : "タグ付けに失敗しました";
    await interaction.editReply(message);
    return;
  }

  await interaction.editReply(`「${gameTitle}」としてタグ付けしました`);
}
