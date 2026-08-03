import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// GET /api/photos/search?game=&uploader=&from=&to=
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const game = searchParams.get("game") ?? undefined;
  const uploaderId = searchParams.get("uploader") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const candidates = await db.photo.findMany({
    where: {
      gameTitle: game ? { contains: game, mode: "insensitive" } : undefined,
      uploaderId: uploaderId ?? undefined,
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
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

  return NextResponse.json({ photos: allowed });
}
