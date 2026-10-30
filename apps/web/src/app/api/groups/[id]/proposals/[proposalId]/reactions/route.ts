import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { z } from "zod";
import { completeIfAllPurchased, syncAgreement } from "@/lib/proposalPromotion";

const reactSchema = z.object({
  type: z.enum(["LIKE", "MAYBE", "PASS"]),
});

// POST /api/groups/:id/proposals/:proposalId/reactions … リアクションをトグルする。
// 同じ種類を再度押すと取り消し、別の種類を押すと切り替える。
// グループの全員が「やりたい」になると「みんなでやりたい」（AGREED）へ上がる。
// 「みんなでやりたい」の間も投票は変えられ、誰かが外せばウィッシュリストへ戻る。
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; proposalId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = reactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.id },
  });
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "PENDING" && proposal.status !== "AGREED") {
    return NextResponse.json({ error: "この提案は既に決着しています" }, { status: 409 });
  }

  const existing = await db.groupGameProposalReaction.findUnique({
    where: { proposalId_userId: { proposalId: params.proposalId, userId: user.id } },
  });

  const removedVote = Boolean(existing && existing.type === parsed.data.type);
  if (removedVote) {
    await db.groupGameProposalReaction.delete({ where: { id: existing!.id } });
  } else {
    await db.groupGameProposalReaction.upsert({
      where: { proposalId_userId: { proposalId: params.proposalId, userId: user.id } },
      create: { proposalId: params.proposalId, userId: user.id, type: parsed.data.type },
      update: { type: parsed.data.type },
    });
  }

  // 投票も取り消しも記録する（❤️と同じ。取り消しは行ごと消えるので後から辿れない）
  await logActivity({
    kind: removedVote ? "proposal.vote_removed" : "proposal.voted",
    targetId: proposal.id,
    targetName: proposal.title,
    groupId: params.id,
    actorId: user.id,
    detail: { type: parsed.data.type },
  });

  // 全員が「やりたい」なら「みんなでやりたい」へ上げ、外れたらウィッシュリストへ戻す（lib/proposalPromotion.ts）。
  // **ここではゲームリストに入れない。** 入るのは、やりたい人が全員「買った」を付けたとき（purchases の API）
  const stage = await syncAgreement(params.proposalId, params.id);
  // 一度ウィッシュリストへ戻ったあと上がり直したときは、「買った」が既に全員そろっていることがある
  // （戻っても「買った」は消さない）。その場合はここでプレイ予定に入れる
  const accepted = stage === "agreed" ? await completeIfAllPurchased(params.proposalId, params.id) : false;

  const updated = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId },
    include: { proposedBy: true, reactions: { include: { user: true } } },
  });

  invalidateGroup(params.id);
  return NextResponse.json({ proposal: updated, stage, accepted });
}
