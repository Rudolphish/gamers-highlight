import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { refreshExternalGameData, REFRESH_INTERVAL_MS } from "@/lib/externalGameCache";
import { gameCacheTag } from "@/lib/steam";

// POST /api/groups/:id/games/:gameId/refresh … ゲーム詳細ページの外部情報を取り直す。
//
// 対象は2種類あり、扱いが違う：
//   - DBに保存している情報（ジャンル / YouTube動画 / HowLongToBeat / カバー画像）
//     → 外部APIを引き直してExternalGameCacheとGroupGameを更新する
//   - 描画のたびに取得している情報（Steamのレビュー・価格・ニュース、ITADの最安値）
//     → Next.jsのデータキャッシュに載っているので、タグを無効化して次の描画で取り直させる
//
// 間隔制限はExternalGameCache.updatedAtで見る。このキャッシュはsteamAppId単位で
// グループ横断に共有されるため、制限も共有される（同じゲームを複数グループが
// 持っていても、外部APIを叩くのは全体で1日1回に収まる）。
// YouTubeのsearch.listはクォータ消費が大きい（無料枠は実質100検索/日）ので、
// この制限が無いと連打で簡単に枯れる。
export async function POST(
  _req: Request,
  { params }: { params: { id: string; gameId: string } }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 保存済みデータを書き換え、外部APIのクォータも消費するため、他の更新系と同じEDITOR以上にする
  const allowed = await hasGroupPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const game = await db.groupGame.findUnique({
    where: { id: params.gameId, groupId: params.id },
    select: { id: true, steamAppId: true, title: true },
  });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cache = await db.externalGameCache.findUnique({
    where: { steamAppId: game.steamAppId },
    select: { updatedAt: true },
  });

  if (cache) {
    const elapsed = Date.now() - cache.updatedAt.getTime();
    if (elapsed < REFRESH_INTERVAL_MS) {
      const nextAvailableAt = new Date(cache.updatedAt.getTime() + REFRESH_INTERVAL_MS);
      return NextResponse.json(
        {
          error: "このゲームの情報は最近更新されています。しばらく待ってから試してください。",
          refreshedAt: cache.updatedAt.toISOString(),
          nextAvailableAt: nextAvailableAt.toISOString(),
        },
        { status: 429 }
      );
    }
  }

  const { headerImage, ...external } = await refreshExternalGameData(game.steamAppId, game.title);

  await db.groupGame.update({
    where: { id: game.id },
    data: { ...external, ...(headerImage ? { coverUrl: headerImage } : {}) },
  });

  // 描画のたびに取っている側（Steamレビュー・価格・ニュース、ITAD最安値）を次回取り直させる
  revalidateTag(gameCacheTag(game.steamAppId));

  const updated = await db.externalGameCache.findUnique({
    where: { steamAppId: game.steamAppId },
    select: { updatedAt: true },
  });
  const refreshedAt = updated?.updatedAt ?? new Date();

  return NextResponse.json({
    ok: true,
    refreshedAt: refreshedAt.toISOString(),
    nextAvailableAt: new Date(refreshedAt.getTime() + REFRESH_INTERVAL_MS).toISOString(),
  });
}
