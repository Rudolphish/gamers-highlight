import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getOrFetchExternalGameData } from "@/lib/externalGameCache";
import { z } from "zod";

const reactSchema = z.object({
  type: z.enum(["LIKE", "MAYBE", "PASS"]),
});

// POST /api/groups/:id/proposals/:proposalId/reactions … リアクションをトグルする。
// 同じ種類を再度押すと取り消し、別の種類を押すと切り替える。
// LIKEがグループの過半数（floor(メンバー数/2)+1）に達すると、自動でGroupGame（WISHLIST）に昇格する。
export async function POST(
  req: Request,
  { params }: { params: { id: string; proposalId: string } }
) {
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
  if (proposal.status !== "PENDING") {
    return NextResponse.json({ error: "この提案は既に決着しています" }, { status: 409 });
  }

  const existing = await db.groupGameProposalReaction.findUnique({
    where: { proposalId_userId: { proposalId: params.proposalId, userId: user.id } },
  });

  if (existing && existing.type === parsed.data.type) {
    await db.groupGameProposalReaction.delete({ where: { id: existing.id } });
  } else {
    await db.groupGameProposalReaction.upsert({
      where: { proposalId_userId: { proposalId: params.proposalId, userId: user.id } },
      create: { proposalId: params.proposalId, userId: user.id, type: parsed.data.type },
      update: { type: parsed.data.type },
    });
  }

  const likeCount = await db.groupGameProposalReaction.count({
    where: { proposalId: params.proposalId, type: "LIKE" },
  });

  const group = await db.group.findUnique({
    where: { id: params.id },
    select: { _count: { select: { members: true } } },
  });
  const totalMembers = 1 + (group?._count.members ?? 0); // オーナー分+1
  const threshold = Math.floor(totalMembers / 2) + 1;

  let promoted = false;
  if (likeCount >= threshold) {
    const { headerImage, ...external } = await getOrFetchExternalGameData(
      proposal.steamAppId,
      proposal.title
    );
    try {
      await db.groupGame.create({
        data: {
          groupId: params.id,
          steamAppId: proposal.steamAppId,
          title: proposal.title,
          // 提案時に組み立てた固定パスより、appdetailsが返す正しいURLを優先する
          coverUrl: headerImage ?? proposal.coverUrl,
          ...external,
          addedById: proposal.proposedById,
        },
      });
    } catch {
      // 既にリストにある場合（レース条件等）は無視して採用扱いにする
    }
    await db.groupGameProposal.update({
      where: { id: params.proposalId },
      data: { status: "ACCEPTED" },
    });
    promoted = true;
  }

  const updated = await db.groupGameProposal.findUnique({
    where: { id: params.proposalId },
    include: { proposedBy: true, reactions: { include: { user: true } } },
  });

  return NextResponse.json({ proposal: updated, promoted });
}
