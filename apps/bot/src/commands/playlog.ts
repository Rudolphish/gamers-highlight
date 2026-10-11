import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { setPlayLogOpt, type PlayLogStatus } from "../lib/apiClient.js";
import { refreshPlayMembersNow } from "../lib/playTracker.js";

// /playlog on|off|status … プレイ記録（グループで一緒に遊んだ時間）から外れる・戻る・状態を見る。
//
// **既定は全員が対象**で、記録されたくない人がここで外れる（2026-10-10 ユーザー判断）。
// 外れるのはこのサーバーのグループだけで、過去の記録は消さない。設計は docs/play-log.md。
//
// 名前を英字にしたのは、入力中にIMEを切り替えなくて済むようにするため（既存の /tag にも揃う）。
// 日本語のDiscordでは「プレイ記録」と表示される。
export const data = new SlashCommandBuilder()
  .setName("playlog")
  .setNameLocalizations({ ja: "プレイ記録" })
  .setDescription("Record time this group plays together")
  .setDescriptionLocalizations({ ja: "グループで一緒に遊んだ時間の記録" })
  .addSubcommand((sub) =>
    sub
      .setName("on")
      .setDescription("Count me in")
      .setDescriptionLocalizations({ ja: "自分を記録の対象に戻す" })
  )
  .addSubcommand((sub) =>
    sub
      .setName("off")
      .setDescription("Stop counting me")
      .setDescriptionLocalizations({ ja: "自分を記録の対象から外す（過去の記録は残ります）" })
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show whether I am counted")
      .setDescriptionLocalizations({ ja: "自分が記録の対象かどうかを見る" })
  );

const linkUrl = () => `${process.env.INTERNAL_API_BASE_URL}/settings/discord`;

function message(status: PlayLogStatus | null, action: "on" | "off" | "status"): string {
  switch (status) {
    case "counted":
      return action === "on"
        ? "プレイ記録の対象に戻しました。VCで2人以上が同じゲームを遊ぶと、グループの記録になります。"
        : "あなたはプレイ記録の対象です。外れるときは `/playlog off` を使ってください。";
    case "opted-out":
      return action === "off"
        ? "プレイ記録の対象から外しました。これからの記録には入りません（これまでの記録は残ります）。戻すときは `/playlog on` です。"
        : "あなたはプレイ記録の対象から外れています。戻すときは `/playlog on` を使ってください。";
    case "unlinked":
      return `アプリとDiscordの連携がまだのため、記録の対象になっていません。先に連携してください: ${linkUrl()}`;
    case "not-member":
      return "このサーバーのグループのメンバーではないため、記録の対象になっていません。";
    case "no-group":
      return "このサーバーに対応するグループがありません。";
    default:
      return "処理に失敗しました。時間をおいてもう一度試してください。";
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "サーバー内でのみ使用できます", ephemeral: true });
    return;
  }

  // Web側の応答がDiscordの3秒の期限を超えることがあるので先に一次応答する。本人にだけ見える形
  await interaction.deferReply({ ephemeral: true });

  const action = interaction.options.getSubcommand(true) as "on" | "off" | "status";
  const status = await setPlayLogOpt({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    action,
  });

  // 外れた・戻った直後から数え方を変える（対象者の一覧は普段15分おきにしか取り直さない）
  if (status !== null && action !== "status") {
    await refreshPlayMembersNow(interaction.guildId).catch((err) =>
      console.error("[playlog] 対象者の取り直しに失敗", err)
    );
  }

  await interaction.editReply(message(status, action));
}
