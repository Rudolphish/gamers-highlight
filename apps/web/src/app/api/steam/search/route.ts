import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { searchSteamGames } from "@/lib/steam";

// GET /api/steam/search?q=<ゲーム名> … Steamストア検索のプロキシ（ブラウザから直接叩くとCORSで弾かれるため）
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const results = await searchSteamGames(q);
  return NextResponse.json({ results });
}
