// Discord REST APIへの直接呼び出し（discord.jsクライアントは使わない）。
// apps/botはこのPCでPM2常駐しているだけの別プロセスなので、Vercel上のcronからは
// Botプロセスを経由せず、同じBotトークンでREST APIを直接叩いてメッセージを投稿する。

const DISCORD_API_BASE = "https://discord.com/api/v10";

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
