// Discord REST APIへの直接呼び出し（discord.jsクライアントは使わない）。
// apps/botはこのPCでPM2常駐しているだけの別プロセスなので、Vercel上のcronからは
// Botプロセスを経由せず、同じBotトークンでREST APIを直接叩いてメッセージを投稿する。

const DISCORD_API_BASE = "https://discord.com/api/v10";

// メッセージ投稿が可能なチャンネル種別（GUILD_TEXT / GUILD_ANNOUNCEMENT）
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);

export type DiscordChannelOption = { id: string; name: string };

/**
 * 指定サーバー（guildId）内の、メッセージ投稿可能なテキスト/アナウンスチャンネル一覧を取得する。
 * Botがそのサーバーに参加していない・権限が無い場合はnullを返す（例外は投げない）。
 */
export async function listGuildTextChannels(guildId: string): Promise<DiscordChannelOption[] | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;

    const channels = (await res.json()) as { id: string; name: string; type: number; position: number }[];
    return channels
      .filter((c) => POSTABLE_CHANNEL_TYPES.has(c.type))
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch {
    return null;
  }
}

/** 指定チャンネルにメッセージを投稿する。失敗時はfalseを返す（例外は投げない） */
export async function postDiscordMessage(channelId: string, content: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;

  try {
    const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
