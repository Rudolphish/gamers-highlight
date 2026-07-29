import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/photos/search?game=&uploader=&from=&to=
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const game = searchParams.get("game") ?? undefined;
  const uploaderId = searchParams.get("uploader") ?? undefined;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const photos = await db.photo.findMany({
    where: {
      gameTitle: game ? { contains: game, mode: "insensitive" } : undefined,
      uploaderId: uploaderId ?? undefined,
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
      // TODO: 自分が閲覧権限を持つアルバムの写真のみに絞り込むフィルタを追加
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ photos });
}
