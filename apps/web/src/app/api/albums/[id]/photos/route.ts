import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAlbumPermission } from "@/lib/permissions";

// GET /api/albums/:id/photos … アルバム内の写真一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const photos = await db.photo.findMany({
    where: { albumId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ photos });
}
