const BASE_URL = process.env.INTERNAL_API_BASE_URL!;
const SECRET = process.env.INTERNAL_API_SECRET!;

type IngestPayload = {
  discordUserId: string;
  channelId: string;
  guildId: string;
  attachmentUrl: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds?: number; // 動画のみ
  discordMessageId: string;
  postedAt: number;
  rawTag?: string | null; // メッセージ本文から抽出した正規化済みハッシュタグ
};

/** Webアプリ側の /api/discord/ingest に画像取り込みを依頼する */
export async function ingestPhoto(payload: IngestPayload) {
  const res = await fetch(`${BASE_URL}/api/discord/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`[apiClient] ingest failed: ${res.status} ${await res.text()}`);
  }
  return res.ok;
}
