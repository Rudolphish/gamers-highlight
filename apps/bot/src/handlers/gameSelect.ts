import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
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
 * 見つからなかった場合は**やり直すか未分類のままにするかを選ばせる**。
 * カタカナで出ず英語なら出る、という取りこぼしが普通に起きるため、
 * 1回外したら終わりにはしない。
 *
 * 添付が複数あっても**メッセージごとに1回だけ**聞く（選択は同じメッセージの
 * 未分類の投稿すべてに反映される）。
 */

const PREFIX = "pickgame";
const MODAL_PREFIX = "pickgame-modal";
const RETRY_PREFIX = "pickgame-retry";
const SKIP_PREFIX = "pickgame-skip";
const MANUAL_VALUE = "__manual__";
const INPUT_ID = "gameName";

/**
 * customIdには「投稿のメッセージID」と「問いかけのメッセージID」の2つを持たせる。
 * 前者はどの投稿への回答かを、後者は片付けのために問いかけを消すのに使う。
 * エフェメラルな返信から辿ると問いかけ自体には触れないため、IDを運ぶ必要がある。
 */
type Target = { messageId: string; promptId: string };

function encode(prefix: string, t: Target): string {
  return `${prefix}:${t.messageId}:${t.promptId}`;
}

function decode(customId: string): Target {
  const [, messageId = "", promptId = ""] = customId.split(":");
  return { messageId, promptId };
}

export function isGameSelect(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

export function isGameModal(customId: string): boolean {
  return customId.startsWith(`${MODAL_PREFIX}:`);
}

export function isGameButton(customId: string): boolean {
  return customId.startsWith(`${RETRY_PREFIX}:`) || customId.startsWith(`${SKIP_PREFIX}:`);
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
  const target: Target = { messageId, promptId: interaction.message.id };
  const value = interaction.values[0];

  // 自由入力は入力欄を出す。ここではdeferしない（モーダルは未応答の状態でしか出せない）
  if (value === MANUAL_VALUE) {
    await showNameModal(interaction, target);
    return;
  }

  const steamAppId = Number(value);
  if (!Number.isInteger(steamAppId)) return;

  await interaction.deferReply({ ephemeral: true });
  await applyAndReply(interaction, target, { steamAppId });
}

export async function handleGameModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;

  const target = decode(interaction.customId);
  const query = interaction.fields.getTextInputValue(INPUT_ID).trim();
  if (!query) return;

  // Steam検索とゲーム登録が入るので、Discordの3秒制限に収まらない。先に猶予を取る
  await interaction.deferReply({ ephemeral: true });
  await applyAndReply(interaction, target, { query });
}

/** 見つからなかったときの「もう一度入力」「未分類のままにする」 */
export async function handleGameButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const target = decode(interaction.customId);

  if (interaction.customId.startsWith(`${RETRY_PREFIX}:`)) {
    // ボタンからならモーダルを出せる（モーダル送信への応答としては出せない）
    await showNameModal(interaction, target);
    return;
  }

  await interaction.update({
    content: "未分類のままにしました。後から `/tag` かアプリの画面でゲームを設定できます。",
    components: [],
  });
  await deletePrompt(interaction, target.promptId);
}

async function showNameModal(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  target: Target
) {
  const modal = new ModalBuilder()
    .setCustomId(encode(MODAL_PREFIX, target))
    .setTitle("ゲーム名を入力")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_ID)
          .setLabel("ゲーム名")
          .setPlaceholder("例: デルタフォース / Delta Force")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal).catch((err) => {
    console.error("[bot] 入力欄を出せなかった", err);
  });
}

/** 選択・入力の結果をWeb側に反映し、同じ文面で返す */
async function applyAndReply(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  target: Target,
  input: { steamAppId?: number; query?: string }
) {
  const result = await assignGame({
    guildId: interaction.guildId!,
    messageId: target.messageId,
    discordUserId: interaction.user.id,
    ...input,
  });

  if (!result.ok) {
    if (!input.query) {
      await interaction.editReply("反映できませんでした。");
      return;
    }

    // カタカナで出ず英語なら出る、という取りこぼしが普通にあるので、やり直せるようにする
    await interaction.editReply({
      content:
        `「${input.query}」に一致するゲームが見つかりませんでした。\n` +
        "英語名でも試せます（例: デルタフォース → Delta Force）。",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(encode(RETRY_PREFIX, target))
            .setLabel("もう一度入力")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(encode(SKIP_PREFIX, target))
            .setLabel("未分類のままにする")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return;
  }

  if (!result.updated) {
    // 投稿者以外が選んだ場合、既に他の手段で分類済みの場合もここに来る
    await interaction.editReply({
      content:
        "反映する投稿がありませんでした。自分が投稿した、まだゲームが決まっていないスクショにだけ設定できます。",
      components: [],
    });
    return;
  }

  await interaction.editReply({
    content: `「${result.gameTitle}」に設定しました（${result.updated}件）`,
    components: [],
  });
  await deletePrompt(interaction, target.promptId);
}

/**
 * 用が済んだ問いかけを消す。チャンネルが問いかけで埋まると邪魔になる。
 *
 * エフェメラルな返信からは問いかけ自体に触れないため、IDで引き直して消す。
 * 既に消えている場合もあるので、失敗は無視してよい。
 */
async function deletePrompt(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction,
  promptId: string
) {
  if (!promptId) return;
  await interaction.channel?.messages
    .delete(promptId)
    .catch(() => {});
}
