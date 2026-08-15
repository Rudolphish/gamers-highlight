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
  // 添付ファイルの元のファイル名。Steamのスクショは <appId>_<日時>_<連番>.jpg なので、
  // タグもチャンネル設定も無いときのゲーム判定に使える
  fileName?: string | null;
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

  const text = await res.text();
  if (!res.ok) {
    console.error(`[apiClient] ingest failed: ${res.status} ${text}`);
  } else {
    // 成功時もPhotoが実際に作られたか/skippedで無視されたかを常に可視化する
    console.log(`[apiClient] ingest ok: ${text}`);
  }
  return res.ok;
}

type TagPayload = {
  discordUserId: string;
  guildId: string;
  gameTitle: string;
  tag: string;
};

type TagResult = { ok: true } | { ok: false; status: number };

/** Webアプリ側の /api/discord/tag に、直近のスクショへのゲームタグ付けを依頼する */
export async function tagPhoto(payload: TagPayload): Promise<TagResult> {
  const res = await fetch(`${BASE_URL}/api/discord/tag`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`[apiClient] tag failed: ${res.status} ${await res.text()}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

/** Webアプリ側の /api/internal/bot-heartbeat に生存報告を送る（死活監視用） */
export async function sendHeartbeat(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/bot-heartbeat`, {
      method: "POST",
      headers: { "x-internal-secret": SECRET },
    });
    if (!res.ok) {
      console.error(`[apiClient] heartbeat failed: ${res.status}`);
    }
  } catch (err) {
    console.error("[apiClient] heartbeat failed", err);
  }
}
