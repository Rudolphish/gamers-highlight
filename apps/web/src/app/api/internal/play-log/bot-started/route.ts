import { NextResponse } from "next/server";
import { closeOpenSessionsAt } from "@/lib/playLog";

/**
 * Botが起動した直後に1回だけ叩く。落ちていた間に終わったものとして、進行中のプレイ記録を
 * **最後に生きていた時刻で閉じ、「推定」の印を付ける**（少なめに数える側に倒す）。
 * まだ続いていた組は、直後のスナップショット（`resumeAfter` 付き）で続きとしてつなぎ直される。
 *
 * POST /api/internal/play-log/bot-started  { previousSeenAt: ISO文字列 | null }
 *
 * `previousSeenAt` が null（初回起動）なら何もしない。どこで切ればよいか分からないため。
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { previousSeenAt?: unknown } | null;
  const raw = body?.previousSeenAt;
  if (raw === null || raw === undefined) return NextResponse.json({ ok: true, closed: 0 });

  const lastSeenAt = typeof raw === "string" ? new Date(raw) : null;
  if (!lastSeenAt || Number.isNaN(lastSeenAt.getTime())) {
    return NextResponse.json({ error: "invalid previousSeenAt" }, { status: 400 });
  }

  const closed = await closeOpenSessionsAt(lastSeenAt);
  return NextResponse.json({ ok: true, closed });
}
