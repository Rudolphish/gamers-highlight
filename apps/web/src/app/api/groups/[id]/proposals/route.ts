import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getSteamAppSummary } from "@/lib/steam";
import { z } from "zod";

const proposeGameSchema = z.object({
  steamAppId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().trim().url().optional(),
});

// GET /api/groups/:id/proposals … 未決着（PENDING）の提案一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const proposals = await db.groupGameProposal.findMany({
    where: { groupId: params.id, status: "PENDING" },
    include: { proposedBy: true, reactions: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ proposals });
}

// POST /api/groups/:id/proposals … ゲームを提案する（グループメンバーなら誰でも）
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = proposeGameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const alreadyInList = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: params.id, steamAppId: parsed.data.steamAppId } },
  });
  if (alreadyInList) {
    return NextResponse.json({ error: "このゲームは既にリストに追加されています" }, { status: 409 });
  }

  const alreadyProposed = await db.groupGameProposal.findFirst({
    where: { groupId: params.id, steamAppId: parsed.data.steamAppId, status: "PENDING" },
  });
  if (alreadyProposed) {
    return NextResponse.json({ error: "このゲームは既に提案されています" }, { status: 409 });
  }

  // クライアントが送ってくるcoverUrlは steam/apps/<id>/header.jpg という固定パスの組み立てで、
  // Steamがアセットを store_item_assets/steam/apps/<id>/<ハッシュ>/header.jpg に移して以降、
  // 新しめのタイトルでは404になる（ゲーム追加・提案の採用時は既にappdetailsの値を優先しているが、
  // 提案の作成だけこの修正から漏れていた）。ここでもappdetailsが返す正しいURLを優先する。
  // appdetailsはAPIキー不要・クォータ無しなので、提案1件につき1回問い合わせても問題ない。
  const summary = await getSteamAppSummary(parsed.data.steamAppId).catch(() => ({
    headerImage: null,
  }));

  const proposal = await db.groupGameProposal.create({
    data: {
      groupId: params.id,
      steamAppId: parsed.data.steamAppId,
      title: parsed.data.title,
      coverUrl: summary.headerImage ?? parsed.data.coverUrl,
      proposedById: user.id,
    },
    include: { proposedBy: true, reactions: { include: { user: true } } },
  });

  return NextResponse.json({ proposal }, { status: 201 });
}
