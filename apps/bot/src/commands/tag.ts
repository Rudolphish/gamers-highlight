import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";

// /tag game:<ゲーム名> … このチャンネルの投稿をチャンネルマッピングと別に
// その場でゲームタグ付けしたい場合のスラッシュコマンド（将来拡張用の雛形）
export const data = new SlashCommandBuilder()
  .setName("tag")
  .setDescription("直前のスクショにゲームタグを付ける")
  .addStringOption((option) =>
    option.setName("game").setDescription("ゲームタイトル").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const game = interaction.options.getString("game", true);
  // TODO: 直近のPhotoレコードを特定してgameTitleを更新するAPIを呼ぶ
  await interaction.reply(`「${game}」としてタグ付けしました（実装予定）`);
}
