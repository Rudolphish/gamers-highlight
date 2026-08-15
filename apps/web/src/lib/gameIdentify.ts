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

  const resolved = await Promise.all(
    appIds.map(async (appId) => {
      const album = albums.find((a) => a.steamAppId === appId);
      const game = groupGames.find((g) => g.steamAppId === appId);
      const known = game?.title ?? album?.gameTitle ?? null;

      return {
        appId,
        title: known ?? (await getSteamAppNameJa(appId)),
        byAppId: album ? { id: album.id, title: album.title } : null,
        byGameLink: game?.album ? { id: game.album.id, title: game.album.title } : null,
      };
    })
  );

  // ゲーム名で紐づくアルバムも探す。app IDを持たないアルバム（Discordのタグから
  // 自動生成されたものなど）は、名前でしか辿れないため。
  const byName = await findAlbumsByGameName(
    resolved.map((r) => r.title).filter((t): t is string => Boolean(t)),
    scope
  );

  return resolved.map((r) => ({
    appId: r.appId,
    title: r.title,
    // 探す順番：ゲーム名が一致するアルバム → app IDが入っているアルバム → ゲーム連携のアルバム
    album:
      (r.title ? byName.get(r.title.toLowerCase()) ?? null : null) ??
      r.byAppId ??
      r.byGameLink,
  }));
}

/** ゲーム名（Album.gameTitle）が一致するアルバムを引く。大文字小文字は区別しない */
async function findAlbumsByGameName(
  titles: string[],
  scope: IdentifyScope
): Promise<Map<string, { id: string; title: string }>> {
  const found = new Map<string, { id: string; title: string }>();
  if (titles.length === 0) return found;

  const albums = await db.album.findMany({
    where: {
      OR: titles.map((t) => ({ gameTitle: { equals: t, mode: "insensitive" as const } })),
      ...scope.albumWhere,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, gameTitle: true },
  });

  // 同名が複数あれば、更新が新しい方を残す（orderByの並び順に依存）
  for (const a of albums) {
    const key = a.gameTitle?.toLowerCase();
    if (key && !found.has(key)) found.set(key, { id: a.id, title: a.title });
  }
  return found;
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
