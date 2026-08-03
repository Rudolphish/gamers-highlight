import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/albums/:id/photos … アルバム内の写真一覧
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // TODO: VIEWER以上の権限チェック（非公開アルバム対応時）
  const photos = await db.photo.findMany({
    where: { albumId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ photos });
}
