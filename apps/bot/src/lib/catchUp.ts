import { ChannelType, SnowflakeUtil, type Client, type Message, type TextChannel } from "discord.js";
import { ingestPhoto } from "./apiClient.js";
import { extractGameTag } from "./gameTag.js";

/**
 * Botが落ちていた間に投稿された画像・動画を、起動時に遡って取り込む。
 *
 * **Botはローカルの常駐プロセスなので、普通に落ちる**（PCの再起動・スリープ・デプロイ）。
 * `messageCreate` はGatewayに繋がっている間しか届かないため、落ちていた間の投稿は
 * **永久に取り込まれない**。しかも取りこぼしたこと自体がどこにも残らないので、
 * 誰も気づけない（実際、1週間空けた回に「その間の投稿は入っていない」と分かった）。
 *
 * **遡る起点は「最後の生存報告」。** 専用のテーブルは作らず、`BotHeartbeat.lastSeenAt`
 * （15分おきに更新している）をそのまま使う。起動時の heartbeat が**更新前の値**を
 * 返してくれるので、それが「自分が最後に生きていた時刻」になる。
 *
 * **重複は起きない。** 取り込みの一意キー `discordMessageId`（`<メッセージID>:<添付ID>`）に
 * ユニーク制約があり、Web側は既にある投稿を `skipped` として弾く。だから
 * 「取りこぼしたぶんだけ」を厳密に選ぶ必要がなく、多めに舐めても害がない。
 */

/** 遡る上限。これより長く落ちていた場合はここで打ち切る（数か月ぶんを漁らない） */
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** 1チャンネルあたりのページ数の上限（1ページ100件）。活発なチャンネルで延々と読まないため */
const MAX_PAGES_PER_CHANNEL = 3;

/** Discord APIの1回の取得上限 */
const PAGE_SIZE = 100;

export type CatchUpResult = {
  /** 遡りの起点。null なら遡らなかった */
  since: Date | null;
  scannedChannels: number;
  /** 添付付きで対象になったメッセージ数 */
  matchedMessages: number;
  /** ingestへ渡した添付の数（Web側で既存として弾かれたぶんも含む） */
  ingestedAttachments: number;
  reason: string | null;
};

/**
 * 落ちていた間のぶんを取り込む。**起動時に1回だけ呼ぶ。**
 *
 * **「どのゲーム？」は聞かない。** 過去のメッセージに今さらBotが返信すると、
 * 復帰のたびに古い投稿へ質問が並ぶ。ゲームが決まらなかったぶんは未分類として残り、
 * アプリの「未分類の投稿」から振り分けられる（そちらの導線は既にある）。
 */
export async function catchUpMissedMessages(
  client: Client,
  previousSeenAt: Date | null,
  now = new Date()
): Promise<CatchUpResult> {
  const empty = { scannedChannels: 0, matchedMessages: 0, ingestedAttachments: 0 };

  if (!previousSeenAt) {
    // 初回起動（生存報告がまだ無い）。どこまで戻ればよいか分からないので遡らない
    return { since: null, ...empty, reason: "前回の生存報告が無いので遡らない" };
  }

  const cutoff = new Date(now.getTime() - MAX_LOOKBACK_MS);
  const since = previousSeenAt < cutoff ? cutoff : previousSeenAt;
  if (previousSeenAt < cutoff) {
    console.log(
      `[catchup] 前回の生存報告が古いため ${MAX_LOOKBACK_MS / 86400000} 日前で打ち切る`
    );
  }

  // タイムスタンプからスノーフレークを作り、`after` で「その時刻より後」だけを取る。
  // 全件取ってから時刻で絞ると、古いチャンネルほど無駄な取得が増える
  const afterId = SnowflakeUtil.generate({ timestamp: since.getTime() }).toString();

  let scannedChannels = 0;
  let matchedMessages = 0;
  let ingestedAttachments = 0;

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;
      // 読めないチャンネルは飛ばす（権限が無ければ例外になるだけで得るものが無い）
      const me = guild.members.me;
      if (!me || !channel.permissionsFor(me)?.has(["ViewChannel", "ReadMessageHistory"])) {
        continue;
      }

      scannedChannels++;
      try {
        const found = await scanChannel(channel, afterId);
        matchedMessages += found.matchedMessages;
        ingestedAttachments += found.ingestedAttachments;
      } catch (err) {
        // 1チャンネルの失敗で全体を止めない（権限変更・APIの一時的な失敗）
        console.error(`[catchup] #${channel.name} の取得に失敗`, err);
      }
    }
  }

  return {
    since,
    scannedChannels,
    matchedMessages,
    ingestedAttachments,
    reason: null,
  };
}

async function scanChannel(channel: TextChannel, afterId: string) {
  let matchedMessages = 0;
  let ingestedAttachments = 0;
  let after = afterId;

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const batch = await channel.messages.fetch({ after, limit: PAGE_SIZE });
    if (batch.size === 0) break;

    // 古い順に処理する（投稿された順に取り込まれる方が自然）。
    // `after` 付きの取得は新しい順で返るので、ここで並べ直す
    const messages = [...batch.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    for (const message of messages) {
      const ingested = await ingestMessage(message);
      if (ingested > 0) matchedMessages++;
      ingestedAttachments += ingested;
    }

    // 次のページは「このページで一番新しいID」から。1ページ未満なら終わり
    after = messages[messages.length - 1]!.id;
    if (batch.size < PAGE_SIZE) break;
  }

  return { matchedMessages, ingestedAttachments };
}

/**
 * 1メッセージぶんを取り込む。**判定は `messageCreate` と同じ条件**に揃えてある
 * （ここだけ緩いと、リアルタイムでは無視される投稿が遡ったときだけ入ることになる）。
 */
async function ingestMessage(message: Message): Promise<number> {
  if (message.author.bot) return 0;
  if (message.attachments.size === 0) return 0;
  if (!message.guildId) return 0;

  const rawTag = extractGameTag(message.content);
  let count = 0;

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType ?? "";
    const isImage = contentType.startsWith("image/");
    const isVideo = contentType.startsWith("video/");
    if (!isImage && !isVideo) continue;
    if (isVideo && attachment.size > 30 * 1024 * 1024) continue;

    await ingestPhoto({
      discordUserId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      attachmentUrl: attachment.url,
      contentType,
      sizeBytes: attachment.size,
      discordMessageId: `${message.id}:${attachment.id}`,
      postedAt: message.createdTimestamp,
      rawTag,
      fileName: attachment.name,
    });
    count++;
  }

  return count;
}
