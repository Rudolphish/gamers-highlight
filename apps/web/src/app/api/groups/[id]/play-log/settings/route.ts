import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import { playLogMinParticipantsKey, setRawAppSetting } from "@/lib/appSettings";
import { getPlayLogMinParticipants } from "@/lib/playLog";

// PATCH /api/groups/:id/play-log/settings  { minParticipants: 1 | 2 }
// プレイ記録の最少人数を切り替える。1人用のテストグループで実際の動きを確かめるためのもの。
//
// **管理者（ADMIN_EMAILS）だけ。** オーナーにも開けていないのは、友人のグループで誤って
// 1人にすると「一緒に遊んだ時間」にソロプレイが混ざるため（2026-10-14 ユーザー判断）。
//
// Botは対象者の一覧と一緒にこの値を取る（15分おき、または誰かが /playlog を打ったとき）ので、
// 切り替えがBotに届くまで最大15分かかる。Web側の判定（スナップショットの反映）は即時。
// 値はグループ画面のキャッシュには載せていない（管理者が開いたときだけ毎回読む）ので無効化は要らない。
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const minParticipants = body?.minParticipants;
  if (minParticipants !== 1 && minParticipants !== 2) {
    return NextResponse.json({ error: "minParticipants must be 1 or 2" }, { status: 400 });
  }

  const group = await db.group.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 既定（2人）は行を持たない
  await setRawAppSetting(playLogMinParticipantsKey(group.id), minParticipants === 1 ? "1" : "");
  return NextResponse.json({ minParticipants: await getPlayLogMinParticipants(group.id) });
}
