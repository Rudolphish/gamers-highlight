import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Discord Botが「どのゲーム？」と聞くときの候補を取る内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * GET /api/internal/group-games?guildId=...
 *
 * **直近に投稿があったゲームを優先して返す。** 選択肢を全部並べても選ぶのが面倒なだけで、
 * 実際に貼るのは「今遊んでいるゲーム」がほとんどのため。投稿が無いゲームは
 * ゲームリストの更新順で埋める。
 */
const MAX_OPTIONS = 3;

export async function GET(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const guildId = new URL(req.url).searchParams.get("guildId");
  if (!guildId) return NextResponse.json({ error: "guildId required" }, { status: 400 });

  const group = await db.group.findUnique({ where: { guildId }, select: { id: true } });
  if (!group) {
    console.warn(`[group-games] guildId=${guildId} に対応するグループが無い`);
    return NextResponse.json({ games: [] });
  }

  const games = await db.groupGame.findMany({
    where: { groupId: group.id },
    orderBy: { updatedAt: "desc" },
    select: {
      steamAppId: true,
      title: true,
      updatedAt: true,
      // 紐付いたアルバムの最新の投稿日時が「直近アクティブ」の目安になる
      album: { select: { photos: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } },
    },
  });

  const ranked = games
    .map((g) => ({
      steamAppId: g.steamAppId,
      title: g.title,
      lastPostedAt: g.album?.photos[0]?.createdAt ?? null,
      updatedAt: g.updatedAt,
    }))
    .sort((a, b) => {
      // 投稿があるものを先に。どちらも投稿があるなら新しい方を先に
      if (a.lastPostedAt && b.lastPostedAt) {
        return b.lastPostedAt.getTime() - a.lastPostedAt.getTime();
      }
      if (a.lastPostedAt) return -1;
      if (b.lastPostedAt) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, MAX_OPTIONS)
    .map(({ steamAppId, title }) => ({ steamAppId, title }));

  return NextResponse.json({ games: ranked });
}
