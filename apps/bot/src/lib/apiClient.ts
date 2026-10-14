import type { PlayingGroup } from "./playLog.js";

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
export async function ingestPhoto(payload: IngestPayload): Promise<{ needsGame: boolean }> {
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
    return { needsGame: false };
  }

  // 成功時もPhotoが実際に作られたか/skippedで無視されたかを常に可視化する
  console.log(`[apiClient] ingest ok: ${text}`);
  try {
    const parsed = JSON.parse(text) as { needsGame?: boolean; skipped?: string };
    // needsGame自体が無い＝Web側がこの機能より前のまま。黙って質問されないと
    // 「Botが壊れている」ように見えるので、原因が分かるようにログへ出す
    if (parsed?.skipped === undefined && parsed?.needsGame === undefined) {
      console.warn(
        "[apiClient] 応答に needsGame がない。Web側のデプロイが古い可能性がある"
      );
    }
    return { needsGame: Boolean(parsed?.needsGame) };
  } catch {
    return { needsGame: false };
  }
}

export type GroupGameOption = { steamAppId: number; title: string };

/** 「どのゲーム？」の選択肢（グループのゲームリスト）を取る */
export async function fetchGroupGames(guildId: string): Promise<GroupGameOption[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/internal/group-games?guildId=${encodeURIComponent(guildId)}`,
      { headers: { "x-internal-secret": SECRET } }
    );
    if (!res.ok) {
      console.error(`[apiClient] fetchGroupGames failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { games?: GroupGameOption[] };
    return data.games ?? [];
  } catch (err) {
    console.error("[apiClient] fetchGroupGames failed", err);
    return [];
  }
}

/** 選ばれたゲームを、そのメッセージの未分類の投稿に反映する */
export async function assignGame(payload: {
  guildId: string;
  messageId: string;
  discordUserId: string;
  /** 候補から選ばれた場合 */
  steamAppId?: number;
  /** 自由入力の場合。Web側でSteam検索→ゲーム登録→アルバム作成まで行う */
  query?: string;
}): Promise<{ ok: boolean; gameTitle?: string; updated?: number }> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/assign-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as {
      gameTitle?: string;
      updated?: number;
    } | null;
    if (!res.ok) {
      console.error(`[apiClient] assign-game failed: ${res.status}`);
      return { ok: false };
    }
    return { ok: true, gameTitle: data?.gameTitle, updated: data?.updated };
  } catch (err) {
    console.error("[apiClient] assignGame failed", err);
    return { ok: false };
  }
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
export async function sendHeartbeat(): Promise<{ previousSeenAt: Date | null }> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/bot-heartbeat`, {
      method: "POST",
      headers: { "x-internal-secret": SECRET },
    });
    if (!res.ok) {
      console.error(`[apiClient] heartbeat failed: ${res.status}`);
      return { previousSeenAt: null };
    }
    // **更新される前の時刻**が返る＝自分が最後に生きていた時刻。
    // 起動時の1回だけ、落ちていた間を遡るのに使う（lib/catchUp.ts）
    const data = (await res.json()) as { previousSeenAt?: string | null };
    const previous = data?.previousSeenAt ? new Date(data.previousSeenAt) : null;
    return { previousSeenAt: previous && !Number.isNaN(previous.getTime()) ? previous : null };
  } catch (err) {
    console.error("[apiClient] heartbeat failed", err);
    return { previousSeenAt: null };
  }
}

// ───────────────────────────────────────────────────────────
// プレイ記録（docs/play-log.md）
// ───────────────────────────────────────────────────────────

/** そのサーバーで数えてよい人。グループが無いサーバーは group: false（そのサーバーは見ない） */
export async function fetchPlayLogMembers(
  guildId: string
): Promise<{ group: boolean; discordUserIds: string[]; minParticipants: number } | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/internal/play-log/members?guildId=${encodeURIComponent(guildId)}`,
      { headers: { "x-internal-secret": SECRET } }
    );
    if (!res.ok) {
      console.error(`[apiClient] play-log members failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { group?: boolean; discordUserIds?: string[]; minParticipants?: number };
    return {
      group: Boolean(data.group),
      discordUserIds: data.discordUserIds ?? [],
      // 古いWebは返さない。そのときは今までどおり2人
      minParticipants: data.minParticipants === 1 ? 1 : 2,
    };
  } catch (err) {
    console.error("[apiClient] play-log members failed", err);
    return null;
  }
}

/**
 * いまの状態を送る。**失敗したら ok: false**（呼び出し側は「送れた」と記録せず、次の機会に送り直す）。
 * 理由を返すのは `/playlog status` で本人に見せるため（ログを見られない場面でも切り分けられるように）
 */
export async function sendPlaySnapshot(payload: {
  guildId: string;
  activities: PlayingGroup[];
  resumeAfter?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/play-log/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`[apiClient] play-log snapshot failed: ${res.status} ${body}`);
      return { ok: false, reason: `HTTP ${res.status} ${body}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    console.error("[apiClient] play-log snapshot failed", err);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** 起動直後に1回。落ちていた間に終わったものとして、進行中の記録を前回生きていた時刻で閉じてもらう */
export async function notifyPlayLogBotStarted(previousSeenAt: Date | null): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/play-log/bot-started`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify({ previousSeenAt: previousSeenAt?.toISOString() ?? null }),
    });
    if (!res.ok) {
      console.error(`[apiClient] play-log bot-started failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[apiClient] play-log bot-started failed", err);
    return false;
  }
}

export type PlayLogStatus = "no-group" | "unlinked" | "not-member" | "counted" | "opted-out";

/** `/playlog on|off|status`。失敗したら null */
export async function setPlayLogOpt(payload: {
  guildId: string;
  discordUserId: string;
  action: "on" | "off" | "status";
}): Promise<PlayLogStatus | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/internal/play-log/opt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[apiClient] play-log opt failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status?: PlayLogStatus };
    return data.status ?? null;
  } catch (err) {
    console.error("[apiClient] play-log opt failed", err);
    return null;
  }
}
