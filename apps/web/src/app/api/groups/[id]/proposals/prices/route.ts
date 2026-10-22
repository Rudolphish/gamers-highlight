import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { getSteamPriceInfo } from "@/lib/steam";
import { getSteamStoreLow } from "@/lib/itad";
import { toWishlistPrice, type WishlistPrice } from "@/lib/wishlistPrice";

export const dynamic = "force-dynamic";

// GET /api/groups/:id/proposals/prices … ウィッシュリスト（未決着の提案）の価格をまとめて返す。
//
// **グループ画面とは別に取る。** 外部への問い合わせがゲームの数だけ要るので、ページの描画に混ぜると
// グループ画面を開くたびにその待ちが乗る。画面は先に出し、カードが表示されてからここを読む。
//
// 対象のゲームは**DBから決める**（クエリで受け取らない）。受け取ると、メンバーなら誰でも
// 任意のゲームについて外部APIを叩かせられる。
//
// どちらの取得も6時間キャッシュされる（Steamはゲーム詳細と同じ問い合わせなのでキャッシュも共有）。
// 1件落ちても他は返す（CLAUDE.md「外部依存はセクション単位で失敗させる」）。
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasGroupPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const proposals = await db.groupGameProposal.findMany({
    where: { groupId: params.id, status: "PENDING" },
    select: { steamAppId: true },
    distinct: ["steamAppId"],
  });

  const entries = await Promise.all(
    proposals.map(async ({ steamAppId }) => {
      const [steam, steamLow] = await Promise.allSettled([
        getSteamPriceInfo(steamAppId),
        getSteamStoreLow(steamAppId),
      ]);
      const price = toWishlistPrice(
        steam.status === "fulfilled" ? steam.value : null,
        steamLow.status === "fulfilled" ? steamLow.value : null
      );
      return [steamAppId, price] as const;
    })
  );

  const prices: Record<number, WishlistPrice> = {};
  for (const [steamAppId, price] of entries) {
    if (price) prices[steamAppId] = price;
  }
  return NextResponse.json({ prices });
}
