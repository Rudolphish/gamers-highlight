import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { deleteSession, updateSession } from "@/lib/playLogAdmin";
import { readSessionInput } from "../input";

// PATCH  /api/admin/play-sessions/:id … プレイ記録の時間・ゲーム・参加者を直す（管理者のみ）
// DELETE /api/admin/play-sessions/:id … プレイ記録を消す（管理者のみ）
//
// **進行中の記録は直せない・消せない（409）。** Bot がまだ開け閉めしているため（lib/playLogAdmin.ts）。
// プレイ記録はキャッシュに載せていないので無効化は要らない。
// audit-activity-log: 意図的に記録しない（プレイ記録は活動ログに流していない。docs/play-log.md §4・§11）
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return isAdminEmail(session?.user?.email);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const input = readSessionInput((await req.json().catch(() => null)) as Record<string, unknown> | null);
  if (!input) {
    return NextResponse.json({ error: "startedAt・endedAt・participantIds が必要です" }, { status: 400 });
  }
  const result = await updateSession(params.id, input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = await deleteSession(params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
