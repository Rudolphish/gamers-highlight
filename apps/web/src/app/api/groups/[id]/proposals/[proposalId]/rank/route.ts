import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { MAX_PROPOSAL_RANK, rankProposal } from "@/lib/proposalRanking";

// PATCH /api/groups/:id/proposals/:proposalId/rank … 提案の順位を変える
// body: { rank: 1〜99 | null }   null は「順位なしに戻す」
//
// **提案者本人だけが変えられる。** 区画はその人のウィッシュリストなので、
// オーナーでも他人の並びは触らない（取り下げだけはEDITOR以上にも許してある。
// あちらは「グループに合わない候補を片付ける」操作で、意味が違う）。
//
// 活動ログには記録しない。`ACTIVITY_KINDS` に値を足すとカレンダーと週次まとめの
// 集計に波及するうえ、並べ替えは何度も起きるのでログがそれで埋まる。
const rankSchema = z.object({
  rank: z.number().int().min(1).max(MAX_PROPOSAL_RANK).nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; proposalId: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = rankSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.id },
    select: { proposedById: true, status: true },
  });
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });

  // **本人判定だけでは足りない。** それだとグループを抜けた人が、残っている自分の提案の
  // 順位を変えられる（提案はメンバーから外れても消えない）。見られない人が書けるのは
  // この repo の方針に反するので、グループの権限も見る。
  // 壊して確認したとき、本人判定を外した状態では部外者（outsider）まで200で通った。
  const isMember = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!isMember || proposal.proposedById !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 採用済み・却下済みの提案はもう区画に出ないので、順位を付けても意味がない
  if (proposal.status !== "PENDING") {
    return NextResponse.json({ error: "not pending" }, { status: 400 });
  }

  const ranks = await rankProposal({
    groupId: params.id,
    proposerId: user.id,
    proposalId: params.proposalId,
    rank: parsed.data.rank,
  });

  invalidateGroup(params.id);

  return NextResponse.json({ ranks });
}
