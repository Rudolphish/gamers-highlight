import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { ACTIVITY_DETAIL_MAX_IDS, getActivityDetail } from "@/lib/activityDetail";

// GET /api/activity?ids=a,b,c … 「最近の動き」「みんなの動き」の行を押したときの詳細（lib/activityDetail.ts）。
// 見せられない・無い・混ざっている ids は、権限の無いページと同じく 404（有無そのものを伏せる。CLAUDE.md）
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9:_-]{1,64}$/;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > ACTIVITY_DETAIL_MAX_IDS || !ids.every((id) => ID.test(id))) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const detail = await getActivityDetail(user.id, ids);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ detail }, { headers: { "Cache-Control": "private, no-store" } });
}
