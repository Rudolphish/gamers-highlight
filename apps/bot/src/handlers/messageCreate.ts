import type { Message } from "discord.js";
import { ingestPhoto } from "../lib/apiClient.js";
import { extractGameTag } from "../lib/gameTag.js";

/**
 * Discordに画像・動画が投稿されるたびに呼ばれる。
 * 添付ファイルをひとつずつWebアプリ側のingest APIへ渡す。
 * 30秒を超える動画はBot側で先に弾き、無駄なダウンロード/APIコールを避ける。
 * メッセージ本文に「#eldenring」のようなハッシュタグがあれば抽出して一緒に渡す
 * （1チャンネルに複数ゲームが混在する運用で、ゲームを判定するための主軸情報）。
 */
export async function handleMessageCreate(message: Message) {
  if (message.author.bot) return;
  if (message.attachments.size === 0) return;
  if (!message.guildId) return; // DMは対象外

  const rawTag = extractGameTag(message.content);

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType ?? "";
    const isImage = contentType.startsWith("image/");
    const isVideo = contentType.startsWith("video/");
    if (!isImage && !isVideo) continue;

    if (isVideo && attachment.size > 30 * 1024 * 1024) {
      console.log(`[bot] skip oversized video: ${attachment.size} bytes`);
      continue;
    }

    await ingestPhoto({
      discordUserId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      attachmentUrl: attachment.url, // Discordの一時URL。ingest側で即DLして永続化する
      contentType,
      sizeBytes: attachment.size,
      discordMessageId: `${message.id}:${attachment.id}`,
      postedAt: message.createdTimestamp,
      rawTag,
    });
  }
}
