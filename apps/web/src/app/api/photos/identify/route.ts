import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSteamAppNameJa } from "@/lib/steam";
import { dbErrorResponse } from "@/lib/dbError";

// POST /api/photos/identify … スクショのファイル名から読み取ったapp IDを、
// 表示できるゲーム名と「そのゲームのアルバムが既にあるか」に変える。
// body: { appIds: number[] }
//
// アップロード画面がファイル名を解析した後に1回だけ呼ぶ。ファイル本体は送らない。
//
// 名前は**アプリが既に知っているものを優先**する。GroupGameやAlbumに入っている
// タイトルを使えばSteamに問い合わせずに済むうえ、グループ内で表記が揃うため。
// どこにも無いゲームのときだけappdetailsを引く。

const MAX_APP_IDS = 20;

export type IdentifiedGame = {
  appId: number;
  title: string | null;
  album: { id: string; title: string } | null;
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.appIds) ? body.appIds : [];
  const appIds: number[] = [
    ...new Set(raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)),
  ].slice(0, MAX_APP_IDS);

  if (appIds.length === 0) return NextResponse.json({ results: [] });

  try {
    // 投稿先に選べるアルバム＝自分が所有しているか参加しているもの（/api/albums と同じ範囲）
    const visibleAlbum = {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    };

    const [albums, groupGames] = await Promise.all([
      db.album.findMany({
        where: { steamAppId: { in: appIds }, ...visibleAlbum },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, gameTitle: true, steamAppId: true },
      }),
      // アルバム側にappIdが入っていなくても、ゲームリスト経由で辿れることがある
      db.groupGame.findMany({
        where: {
          steamAppId: { in: appIds },
          group: {
            OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
          },
        },
        select: {
          steamAppId: true,
          title: true,
          album: { select: { id: true, title: true } },
        },
      }),
    ]);

    const results: IdentifiedGame[] = await Promise.all(
      appIds.map(async (appId) => {
        const album = albums.find((a) => a.steamAppId === appId);
        const game = groupGames.find((g) => g.steamAppId === appId);

        const known = game?.title ?? album?.gameTitle ?? null;
        const title = known ?? (await getSteamAppNameJa(appId));

        return {
          appId,
          title,
          album: album
            ? { id: album.id, title: album.title }
            : game?.album
              ? { id: game.album.id, title: game.album.title }
              : null,
        };
      })
    );

    return NextResponse.json({ results });
  } catch (e) {
    return dbErrorResponse("photos:identify", e);
  }
}
