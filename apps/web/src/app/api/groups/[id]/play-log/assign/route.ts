import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { hasGroupPermission } from "@/lib/permissions";
import { assignUnknownPlay } from "@/lib/playLog";

// POST /api/groups/:id/play-log/assign  { gameKey, groupGameId }
// ゲームが分からなかったプレイ記録に、グループのゲームを結びつける（対応付けの3段目）。
//
// **選べるのはグループのメンバーなら誰でも**（VIEWER以上）。「未分類の投稿」と同じ考え方で、
// 気づいた人が直せるようにしている（2026-10-10 ユーザー判断）。
//
// プレイ記録はキャッシュに載せていない（ゲーム詳細・グループ画面とも毎回読む）ので、
// 無効化は要らない。活動ログにも流さない（M2で決める。docs/play-log.md §4）。
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const gameKey = body?.gameKey;
  const groupGameId = body?.groupGameId;
  if (typeof gameKey !== "string" || typeof groupGameId !== "string") {
    return NextResponse.json({ error: "gameKey and groupGameId required" }, { status: 400 });
  }

  const result = await assignUnknownPlay(params.id, gameKey, groupGameId);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ ok: true, updated: result.updated });
}
