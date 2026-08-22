import { db } from "./db";
import type { AlbumRole, GroupRole } from "@gamers-highlight/db";

const ROLE_RANK: Record<AlbumRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

/**
 * userIdがgroupIdに対して requiredRole 以上の権限を持つか判定する。
 * オーナー本人（Group.ownerId）は常にOWNER権限として扱う。
 */
export async function hasGroupPermission(
  groupId: string,
  userId: string,
  requiredRole: GroupRole
): Promise<boolean> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) return false;
  if (group.ownerId === userId) return true;

  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) return false;

  return ROLE_RANK[membership.role] >= ROLE_RANK[requiredRole];
}

/**
 * userIdがalbumIdに対して requiredRole 以上の権限を持つか判定する。
 * オーナー本人（Album.ownerId）は常にOWNER権限として扱う。
 * それ以外は、アルバム単位の招待（AlbumMember）と、所属グループでの権限
 * （グループメンバーは配下の全アルバムに自動でVIEWER以上を持つ）のうち
 * より強い方を採用する。
 */
export async function hasAlbumPermission(
  albumId: string,
  userId: string,
  requiredRole: AlbumRole
): Promise<boolean> {
  return (await checkAlbumPermission(albumId, userId, requiredRole)).allowed;
}

/**
 * `hasAlbumPermission` と同じ判定をして、**そのアルバムの `groupId` も返す**。
 *
 * 活動ログ（`ActivityLog`）は `groupId` を非正規化して持つ（対象が消えた後でも
 * どのグループの出来事か辿れるように）。判定の中で `album.groupId` はどのみち
 * 読んでいるので、**捨てずに返せば追加のクエリがゼロで済む**。
 * 本番は1クエリ＝1往復（docs/perf-cache.md）なので、ここを引き直すと
 * 書き込みのたびに往復が増える。
 *
 * 権限だけが要る場所は `hasAlbumPermission` のままでよい。
 */
export async function checkAlbumPermission(
  albumId: string,
  userId: string,
  requiredRole: AlbumRole
): Promise<{ allowed: boolean; groupId: string | null }> {
  const album = await db.album.findUnique({
    where: { id: albumId },
    select: { ownerId: true, groupId: true },
  });
  if (!album) return { allowed: false, groupId: null };

  const groupId = album.groupId;
  if (album.ownerId === userId) return { allowed: true, groupId };

  const membership = await db.albumMember.findUnique({
    where: { albumId_userId: { albumId, userId } },
  });
  const albumRank = membership ? ROLE_RANK[membership.role] : -1;

  const groupAllowed = await hasGroupPermission(groupId, userId, "VIEWER");
  const groupRank = groupAllowed ? ROLE_RANK.VIEWER : -1;

  return { allowed: Math.max(albumRank, groupRank) >= ROLE_RANK[requiredRole], groupId };
}
