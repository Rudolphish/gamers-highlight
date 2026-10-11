import { NextResponse } from "next/server";
import { applySnapshot, type PlaySnapshot } from "@/lib/playLog";
import { notifyFinishedPlays, notifyPlayStarted } from "@/lib/playLogNotify";

/**
 * Botが送る「いま、どのVCで誰が何を遊んでいるか」。プレイ記録の行の開閉はここで決まる。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * POST /api/internal/play-log/snapshot
 *   { guildId, activities: [{ voiceChannelId, applicationId, name, participants: [{ discordUserId, since }] }], resumeAfter? }
 *
 * **イベントではなくスナップショット。** 同じものを何度送っても結果は変わらない（冪等）。
 * 設計は docs/play-log.md §5。
 */

// 1つのサーバーのVCに同時にいる人数として十分大きい上限。壊れた入力で延々と回さないため
const MAX_ACTIVITIES = 50;
const MAX_PARTICIPANTS = 50;

const isSnowflake = (v: unknown): v is string => typeof v === "string" && /^\d{1,25}$/.test(v);

function parse(body: unknown): PlaySnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isSnowflake(b.guildId) || !Array.isArray(b.activities) || b.activities.length > MAX_ACTIVITIES) return null;

  const activities: PlaySnapshot["activities"] = [];
  for (const raw of b.activities) {
    if (typeof raw !== "object" || raw === null) return null;
    const a = raw as Record<string, unknown>;
    if (!isSnowflake(a.voiceChannelId)) return null;
    if (a.applicationId !== null && a.applicationId !== undefined && !isSnowflake(a.applicationId)) return null;
    if (typeof a.name !== "string" || a.name.trim().length === 0) return null;
    if (!Array.isArray(a.participants) || a.participants.length > MAX_PARTICIPANTS) return null;

    const participants = [];
    for (const rawP of a.participants) {
      if (typeof rawP !== "object" || rawP === null) return null;
      const p = rawP as Record<string, unknown>;
      if (!isSnowflake(p.discordUserId)) return null;
      const since = typeof p.since === "number" && Number.isFinite(p.since) ? p.since : null;
      participants.push({ discordUserId: p.discordUserId, since });
    }
    activities.push({
      voiceChannelId: a.voiceChannelId,
      applicationId: (a.applicationId as string | null | undefined) ?? null,
      name: a.name.trim(),
      participants,
    });
  }

  const resumeAfter = typeof b.resumeAfter === "string" ? b.resumeAfter : null;
  return { guildId: b.guildId, activities, resumeAfter };
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const snapshot = parse(await req.json().catch(() => null));
  if (!snapshot) return NextResponse.json({ error: "invalid snapshot" }, { status: 400 });

  const result = await applySnapshot(snapshot);

  // 通知はここで送る（playLog.ts はDiscordに触らない）。**通知で落ちても記録の結果は返す**——
  // 500を返すとBotは「送れなかった」として同じスナップショットを送り直し続ける
  try {
    for (const id of result.openedIds ?? []) await notifyPlayStarted(id);
    await notifyFinishedPlays();
  } catch (err) {
    console.error("[playlog] 通知の処理に失敗", err);
  }
  return NextResponse.json({ ok: true, ...result });
}
