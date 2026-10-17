import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createManualSession } from "@/lib/playLogAdmin";
import { readSessionInput } from "./input";

// POST /api/admin/play-sessions … 記録されなかったプレイを手で足す（管理者のみ）
// body: { groupId, groupGameId, startedAt, endedAt, participantIds }（日時は ISO 文字列）
//
// 権限判定はセッションの isAdmin ではなく、必ずサーバー側で isAdminEmail を呼ぶ。
// プレイ記録はキャッシュに載せていない（ゲーム詳細・グループ画面とも毎回読む）ので無効化は要らない。
// audit-activity-log: 意図的に記録しない（プレイ記録は活動ログに流していない。docs/play-log.md §4・§11）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = readSessionInput(body);
  if (!input || typeof body?.groupId !== "string") {
    return NextResponse.json({ error: "groupId・startedAt・endedAt・participantIds が必要です" }, { status: 400 });
  }

  const result = await createManualSession(body.groupId, input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
