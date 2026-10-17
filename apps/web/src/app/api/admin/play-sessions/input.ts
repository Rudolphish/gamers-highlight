import type { SessionInput } from "@/lib/playLogAdmin";

/** 追加・修正で共通の入力の形を確かめる。形が違えば null（中身の妥当性は lib/playLogAdmin.ts で見る） */
export function readSessionInput(body: Record<string, unknown> | null): SessionInput | null {
  if (!body) return null;
  const { startedAt, endedAt, groupGameId, participantIds } = body;
  if (typeof startedAt !== "string" || typeof endedAt !== "string") return null;
  if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== "string")) return null;
  if (groupGameId !== undefined && groupGameId !== null && typeof groupGameId !== "string") return null;
  return {
    startedAt,
    endedAt,
    groupGameId: groupGameId as string | null | undefined,
    participantIds: participantIds as string[],
  };
}
