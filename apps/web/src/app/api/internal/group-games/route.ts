import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Discord Botが「どのゲーム？」と聞くときの候補を取る内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * GET /api/internal/group-games?guildId=...
 *
 * **返すのはステータスが「プレイ中」のゲームだけ。**
 * 以前はアルバムの更新順で埋めていたが、古いアルバムに手動でアップロードすると
 * そのゲームが「直近」として上がってきてしまい、いま遊んでいないものが候補に出ていた。
 * 貼られるスクショは基本的に今遊んでいるゲームなので、そこだけを候補にする。
 *
 * 並び順は「直近に投稿があったもの」を先にする（数が多いときに上から選べるように）。
 *
 * プレイ中が1本も無ければ空で返す。Bot側は「その他（入力する）」を必ず足すので、
 * メニュー自体は出るし、そこからSteam検索→登録まで通る。
 */

/**
 * Discordのセレクトメニューは**選択肢が最大25個**。Botが「その他（入力する）」を
 * 1つ足すので、ゲームに使えるのは24個まで。プレイ中がこれを超えることは
 * まず無いが、超えたら並び順の上から24件になる。
 */
const MAX_OPTIONS = 24;

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
    where: { groupId: group.id, status: "PLAYING" },
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
