import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { completeIfAllPurchased, groupUserIds, requiredPurchasers } from "@/lib/proposalPromotion";

const purchaseSchema = z.object({
  purchased: z.boolean(),
  /** 誰の分か。省略したら自分。他の人の分はグループのオーナーだけが付け外しできる */
  userId: z.string().min(1).optional(),
});

// POST /api/groups/:id/proposals/:proposalId/purchases … 「みんなでやりたい」のゲームを買った（持っている）を付け外しする。
//
// **トグルではなく、付けるか外すかを送ってもらう。** オーナーが代わりに押す経路があるので、
// 本人と同時に押したときにトグルだと打ち消し合って元に戻ってしまう。
//
// 「やりたい」を押した人が全員そろったら、ゲームリストの「プレイ予定」に入る（lib/proposalPromotion.ts）。
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; proposalId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = purchaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const targetId = parsed.data.userId ?? user.id;

  const proposal = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId, groupId: params.id },
    include: { reactions: { select: { userId: true, type: true } }, group: { select: { ownerId: true } } },
  });
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "AGREED") {
    return NextResponse.json({ error: "「みんなでやりたい」に上がっているゲームだけが対象です" }, { status: 409 });
  }

  // 他の人の分はオーナーだけ（2026-10-30 ユーザー判断。押し忘れている人の代わりに付けられるように）
  if (targetId !== user.id && proposal.group.ownerId !== user.id) {
    return NextResponse.json({ error: "他の人の分はグループのオーナーだけが変えられます" }, { status: 403 });
  }

  // 買う必要があるのは「やりたい」を押した人だけ。それ以外の人の分を付けても、プレイ予定に入る条件に効かない
  const required = requiredPurchasers(proposal.reactions, await groupUserIds(params.id));
  if (!required.includes(targetId)) {
    return NextResponse.json({ error: "「やりたい」を押した人だけが対象です" }, { status: 400 });
  }

  // 付ける側は重複を黙って飛ばし、外す側は無くても成功にする。**変わったときだけ**記録を残す
  const changed = parsed.data.purchased
    ? (await db.groupGameProposalPurchase.createMany({
        data: [{ proposalId: proposal.id, userId: targetId }],
        skipDuplicates: true,
      })).count
    : (await db.groupGameProposalPurchase.deleteMany({ where: { proposalId: proposal.id, userId: targetId } })).count;

  if (changed > 0) {
    await logActivity({
      kind: parsed.data.purchased ? "proposal.purchased" : "proposal.purchase_removed",
      targetId: proposal.id,
      targetName: proposal.title,
      groupId: params.id,
      actorId: user.id,
      // オーナーが代わりに付けたときは、誰の分かを残す
      detail: targetId === user.id ? null : { forUserId: targetId },
    });
  }

  const accepted = parsed.data.purchased ? await completeIfAllPurchased(proposal.id, params.id) : false;

  const purchases = await db.groupGameProposalPurchase.findMany({
    where: { proposalId: proposal.id },
    select: { userId: true },
  });

  invalidateGroup(params.id);
  return NextResponse.json({ purchases: purchases.map((p) => p.userId), accepted });
}
