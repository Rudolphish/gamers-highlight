import {
  ActionRowBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Message,
} from "discord.js";
import { fetchGroupGames, assignGame } from "../lib/apiClient.js";

/**
 * ゲームが判別できなかった投稿に「どのゲーム？」と聞く。
 *
 * 普段の使い方（Steamのスクショをクリップボードから貼る）ではファイル名に
 * 手掛かりが何も残らないため、ファイル名からの判別は発火しない。そこをここで拾う。
 *
 * 候補は**直近に投稿があったゲーム3件**まで。全部並べても選ぶのが面倒なだけで、
 * 実際に貼るのは今遊んでいるゲームがほとんどのため。
 * 候補に無い場合は「その他（入力する）」から名前を打てば、Steam検索で見つけて
 * ゲームリストへの登録とアルバム作成までまとめて行う。
 *
 * 添付が複数あっても**メッセージごとに1回だけ**聞く（選択は同じメッセージの
 * 未分類の投稿すべてに反映される）。
 */

/** customIdは `pickgame:<メッセージID>` の形で、どの投稿への回答かを持たせる */
const PREFIX = "pickgame";
const MODAL_PREFIX = "pickgame-modal";
const MANUAL_VALUE = "__manual__";
const INPUT_ID = "gameName";

export function isGameSelect(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

export function isGameModal(customId: string): boolean {
  return customId.startsWith(`${MODAL_PREFIX}:`);
}

/** 未分類の投稿に対して、直近のゲーム候補＋自由入力から選ばせる */
export async function askForGame(message: Message) {
  if (!message.guildId) return;

  const games = await fetchGroupGames(message.guildId);
  console.log(`[bot] ゲームを質問する（候補${games.length}件）`);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:${message.id}`)
    .setPlaceholder("ゲームを選ぶ")
    .addOptions([
      ...games.map((g) => ({
        // Discordの制限に合わせて切り詰める（ラベルは100文字まで）
        label: g.title.slice(0, 100),
        value: String(g.steamAppId),
      })),
      // 候補が空でも必ずこれがあるので、メニュー自体は常に出せる
      // （Discordは選択肢ゼロのメニューを受け付けない）
      { label: "その他（入力する）", value: MANUAL_VALUE },
    ]);

  // 権限不足などで送れないことがある。落とさずログに残す
  await message
    .reply({
      content: "どのゲームのスクショ？（選ばなくても投稿は保存されています）",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      allowedMentions: { repliedUser: false },
    })
    .catch((err) => console.error("[bot] 質問を送れなかった", err));
}

export async function handleGameSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;

  const messageId = interaction.customId.slice(PREFIX.length + 1);
  const value = interaction.values[0];

  // 自由入力は入力欄を出す。ここではdeferしない（モーダルは未応答の状態でしか出せない）
  if (value === MANUAL_VALUE) {
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}:${messageId}`)
      .setTitle("ゲーム名を入力")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(INPUT_ID)
            .setLabel("ゲーム名")
            .setPlaceholder("例: デルタフォース")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal).catch((err) => {
      console.error("[bot] 入力欄を出せなかった", err);
    });
    return;
  }

  const steamAppId = Number(value);
  if (!Number.isInteger(steamAppId)) return;

  await interaction.deferReply({ ephemeral: true });
  await applyAndReply(interaction, messageId, { steamAppId });
}

export async function handleGameModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;

  const messageId = interaction.customId.slice(MODAL_PREFIX.length + 1);
  const query = interaction.fields.getTextInputValue(INPUT_ID).trim();
  if (!query) return;

  // Steam検索とゲーム登録が入るので、Discordの3秒制限に収まらない。先に猶予を取る
  await interaction.deferReply({ ephemeral: true });
  await applyAndReply(interaction, messageId, { query });
}

/** 選択・入力の結果をWeb側に反映し、同じ文面で返す */
async function applyAndReply(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  messageId: string,
  target: { steamAppId?: number; query?: string }
) {
  const result = await assignGame({
    guildId: interaction.guildId!,
    messageId,
    discordUserId: interaction.user.id,
    ...target,
  });

  if (!result.ok) {
    await interaction.editReply(
      target.query
        ? `「${target.query}」に一致するゲームが見つかりませんでした。名前を変えて試してください。`
        : "反映できませんでした。"
    );
    return;
  }

  if (!result.updated) {
    // 投稿者以外が選んだ場合、既に他の手段で分類済みの場合もここに来る
    await interaction.editReply(
      "反映する投稿がありませんでした。自分が投稿した、まだゲームが決まっていないスクショにだけ設定できます。"
    );
    return;
  }

  await interaction.editReply(`「${result.gameTitle}」に設定しました（${result.updated}件）`);

  // 用が済んだ問いかけは残さない。チャンネルが問いかけで埋まると邪魔になる。
  // モーダル経由でも、モーダルを開いた元のメッセージ（＝問いかけ）が入っている
  await interaction.message?.delete().catch(() => {});
}
