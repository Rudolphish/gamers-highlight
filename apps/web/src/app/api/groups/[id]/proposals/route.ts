import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { getOrFetchExternalGameData } from "@/lib/externalGameCache";
import { postDiscordMessage } from "@/lib/discord";
import { promotionThreshold } from "@/lib/proposalPromotion";
import { getNotificationChannel } from "@/lib/notificationTargets";
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

  // 外部データ（カバー画像・ジャンル・クリア時間・関連動画）をここで取ってキャッシュに載せる。
  //
  // クライアントが送ってくるcoverUrlは steam/apps/<id>/header.jpg という固定パスの組み立てで、
  // Steamがアセットを store_item_assets/steam/apps/<id>/<ハッシュ>/header.jpg に移して以降、
  // 新しめのタイトルでは404になる。appdetailsが返す正しいURLを優先する。
  //
  // **クリア時間と関連動画も、ここで埋めておく必要がある。**
  // 提案の詳細ページは ExternalGameCache に既にある場合だけこれらを出す作りで、
  // ページから外部APIを引きに行かない（描画のたびにYouTubeのクォータを消費しないため）。
  // 作成時に埋めていなかったので、**初めて提案されたゲームは採用されるまで
  // クリア時間と動画が空のまま**だった。
  //
  // 費用は提案1件につき1回。ゲームをリストに追加したときと同じで、キャッシュは
  // steamAppId単位で共有されるため、後で採用されても取り直しは起きない。
  const summary = await getOrFetchExternalGameData(
    parsed.data.steamAppId,
    parsed.data.title
  ).catch(() => ({ headerImage: null }));

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

  invalidateGroup(params.id);

  await logActivity({
    kind: "proposal.created",
    targetId: proposal.id,
    targetName: proposal.title,
    groupId: params.id,
    actorId: user.id,
    occurredAt: proposal.createdAt,
  });

  // 名前は作成済みの提案から取る（`include: { proposedBy: true }` で既に読んでいる）。
  // `getCurrentUser()` はIDとメールしか持たないので、ここで引き直すと1往復増える
  await notifyProposal(params.id, proposal.title, proposal.proposedBy.name);

  return NextResponse.json({ proposal }, { status: 201 });
}

/**
 * 提案されたことをグループの通知先（Discord）へ知らせる。
 *
 * **提案は画面を開かないと気づけない。** 投票が集まらないと採用されない仕組みなので、
 * 気づかれないまま流れると提案そのものが機能しない（「提案しても誰も反応しない」という
 * 報告があった）。**この種類の通知先が設定されていなければ何もしない**
 * （送り先は種類ごとに決める。`lib/notificationTargets.ts`）。
 *
 * **通知が失敗しても提案の作成は成功として返す。** 提案はもうDBに入っており、
 * ここで500にすると「提案できなかった」と誤解されて二重に提案される。
 * ただし黙って消さず、失敗はログに残す（`postDiscordMessage` は例外を投げず false を返すので、
 * 戻り値を見ないと失敗がどこにも残らない）。
 */
async function notifyProposal(groupId: string, title: string, proposerName: string | null) {
  const channelId = await getNotificationChannel(groupId, "PROPOSAL");
  if (!channelId) return;

  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { _count: { select: { members: true } } },
  });
  if (!group) return;

  // 昇格の条件は投票API（reactions）と同じ関数から取る。
  // ここで式を書き写すと、片方だけ変わったときに通知の文面だけが嘘になる
  const threshold = promotionThreshold(group._count.members);

  // 表示名が無くてもメールアドレスにはフォールバックしない。
  // Discordチャンネルにメールアドレスを流さないため（価格通知と同じ方針）。
  const who = proposerName ?? "メンバー";

  const message = [
    `💡 **${title}** が提案されました`,
    `提案者: ${who}`,
    `👍 が ${threshold} 人集まるとゲームリストに入ります`,
  ].join("\n");

  const ok = await postDiscordMessage(channelId, message);
  if (!ok) {
    console.error(`[proposals] Discordへの通知に失敗しました groupId=${groupId} channelId=${channelId}`);
  }
}
