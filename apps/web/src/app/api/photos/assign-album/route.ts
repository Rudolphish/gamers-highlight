import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// POST /api/photos/assign-album … 未分類（albumId無し）の投稿を、既存アルバムへまとめて追加する。
// body: { photoIds: string[], albumId: string }
// - 対象の写真は「自分がアップロードした未分類の投稿」のみ許可（他人の投稿を勝手に移動できないようにする）
// - 移動先アルバムはEDITOR以上の権限が必要
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const photoIds: string[] = Array.isArray(body.photoIds) ? body.photoIds : [];
  const albumId: string = body.albumId;

  if (photoIds.length === 0 || !albumId) {
    return NextResponse.json({ error: "photoIds and albumId are required" }, { status: 400 });
  }

  const allowed = await hasAlbumPermission(albumId, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result = await db.photo.updateMany({
    where: {
      id: { in: photoIds },
      albumId: null, // 未分類のものだけ対象（既にアルバムがある投稿は誤操作防止のため対象外）
      uploaderId: user.id, // 自分がアップロードしたものだけ
    },
    data: { albumId },
  });

  // アルバムのupdatedAtを更新して、ホーム画面の並び順に反映させる
  await db.album.update({ where: { id: albumId }, data: {} });

  return NextResponse.json({ movedCount: result.count });
}
