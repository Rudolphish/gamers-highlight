import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// GET /api/albums/:id/photos … アルバム内の写真一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const photos = await db.photo.findMany({
    where: { albumId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ photos });
}
