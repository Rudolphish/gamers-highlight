import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// GET /api/photos/search?game=&uploader=&from=&to=
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const game = searchParams.get("game") ?? undefined;
  const uploaderId = searchParams.get("uploader") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const candidates = await db.photo.findMany({
    where: {
      // ゲームタイトルだけでなく**説明も対象にする**。
      // 「あの場面」を後から探せるようにするのが説明を書く理由なので、
      // 書いた文字列で引っかからないと片手落ちになる
      OR: game
        ? [
            { gameTitle: { contains: game, mode: "insensitive" } },
            { description: { contains: game, mode: "insensitive" } },
          ]
        : undefined,
      uploaderId: uploaderId ?? undefined,
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { descriptionEditor: { select: { name: true, email: true } } },
  });

  // hasAlbumPermissionは非同期関数なので、Array.filter()の中では使わず
  // for文でひとつずつawaitして判定する
  const allowed = [];
  for (const photo of candidates) {
    if (photo.albumId) {
      const canView = await hasAlbumPermission(photo.albumId, user.id, "VIEWER");
      if (canView) allowed.push(photo);
    } else if (photo.uploaderId === user.id) {
      allowed.push(photo);
    }
  }

  // 説明は検索結果でも読めるようにする（**編集はできない**。
  // ここは複数アルバム横断なので、1枚ずつEDITOR権限を判定する足場が無い）。
  return NextResponse.json({
    photos: allowed.map(({ descriptionEditor, ...photo }) => ({
      ...photo,
      descriptionEditorName: descriptionEditor?.name ?? descriptionEditor?.email ?? null,
    })),
  });
}
