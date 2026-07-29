import { db } from "./db";
import type { AlbumRole } from "@gamers-highlight/db";

const ROLE_RANK: Record<AlbumRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

/**
 * userIdがalbumIdに対して requiredRole 以上の権限を持つか判定する。
 * オーナー本人（Album.ownerId）は常にOWNER権限として扱う。
 */
export async function hasAlbumPermission(
  albumId: string,
  userId: string,
  requiredRole: AlbumRole
): Promise<boolean> {
  const album = await db.album.findUnique({
    where: { id: albumId },
    select: { ownerId: true },
  });
  if (!album) return false;
  if (album.ownerId === userId) return true;

  const membership = await db.albumMember.findUnique({
    where: { albumId_userId: { albumId, userId } },
  });
  if (!membership) return false;

  return ROLE_RANK[membership.role] >= ROLE_RANK[requiredRole];
}
