import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getSteamAppNameJa } from "./steam";

export type IdentifiedGame = {
  appId: number;
  title: string | null;
  album: { id: string; title: string } | null;
};

/**
 * 探索範囲。手動アップロードとDiscord取り込みで「誰から見えるか」が違うため、
 * 呼び出し側から条件を渡す。
 *   - 手動:    自分が所有/参加しているアルバム・グループ
 *   - Discord: そのギルドに紐づくグループ
 */
export type IdentifyScope = {
  albumWhere: Prisma.AlbumWhereInput;
  groupGameWhere: Prisma.GroupGameWhereInput;
};

/**
 * Steamのapp IDを「表示できるゲーム名」と「既にあるアルバム」に変える。
 *
 * 名前は**アプリが既に知っているものを優先**する。GroupGameやAlbumに入っている
 * タイトルを使えばSteamに問い合わせずに済むうえ、グループ内で表記が揃うため。
 * どこにも無いゲームのときだけappdetailsを引く。
 *
 * アルバムは2経路で探す。Album.steamAppIdが入っていればそれ、入っていなくても
 * GroupGame経由で紐付いたアルバムを辿る（アルバム側にIDが無い作り方もあるため）。
 */
export async function resolveGamesByAppId(
  appIds: number[],
  scope: IdentifyScope
): Promise<IdentifiedGame[]> {
  if (appIds.length === 0) return [];

  const [albums, groupGames] = await Promise.all([
    db.album.findMany({
      where: { steamAppId: { in: appIds }, ...scope.albumWhere },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, gameTitle: true, steamAppId: true },
    }),
    db.groupGame.findMany({
      where: { steamAppId: { in: appIds }, ...scope.groupGameWhere },
      select: {
        steamAppId: true,
        title: true,
        album: { select: { id: true, title: true } },
      },
    }),
  ]);

  return Promise.all(
    appIds.map(async (appId) => {
      const album = albums.find((a) => a.steamAppId === appId);
      const game = groupGames.find((g) => g.steamAppId === appId);

      const known = game?.title ?? album?.gameTitle ?? null;

      return {
        appId,
        title: known ?? (await getSteamAppNameJa(appId)),
        album: album
          ? { id: album.id, title: album.title }
          : game?.album
            ? { id: game.album.id, title: game.album.title }
            : null,
      };
    })
  );
}

/** 手動アップロード用。自分が所有しているか参加しているものだけを見る */
export function scopeForUser(userId: string): IdentifyScope {
  const mine = { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
  return {
    albumWhere: mine,
    groupGameWhere: { group: mine },
  };
}

/** Discord取り込み用。そのギルドに紐づくグループの中だけを見る */
export function scopeForGroup(groupId: string): IdentifyScope {
  return {
    albumWhere: { groupId },
    groupGameWhere: { groupId },
  };
}
