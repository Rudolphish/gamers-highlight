// IsThereAnyDeal API連携（過去最安値・比較ページへのリンク）。APIキーが必要（.envのITAD_API_KEY）。
// 公式ドキュメント化された安定したAPIだが、キー未設定の環境でも壊れないようnullで返す。

import { gameCacheTag } from "./steam";

const ITAD_BASE = "https://api.isthereanydeal.com";

// Next.js 14ではオプション無しのfetchが既定でキャッシュされ、最安値が固定されたままになる。
// Steam側と同じタグを付け、手動リフレッシュでまとめて無効化できるようにする。
// （POSTのhistorylowはそもそもキャッシュ対象外だが、lookupと同じ再検証期間で揃えておく）
function itadFetchOptions(steamAppId: number): RequestInit {
  return { next: { revalidate: 60 * 60 * 6, tags: [gameCacheTag(steamAppId)] } };
}

async function lookupGame(steamAppId: number, key: string): Promise<{ id: string; slug: string } | null> {
  const res = await fetch(
    `${ITAD_BASE}/games/lookup/v1?key=${key}&appid=${steamAppId}`,
    itadFetchOptions(steamAppId)
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.found || !data.game?.id) return null;
  return { id: data.game.id, slug: data.game.slug };
}

export type ItadSummary = {
  slug: string;
  pageUrl: string;
  lowPrice: number;
  lowShopName: string;
  lowCut: number;
};

/** 全ストア横断の過去最安値と、IsThereAnyDealの比較ページURLを取得する。キー未設定/データ無しはnull */
export async function getItadSummary(steamAppId: number): Promise<ItadSummary | null> {
  const key = process.env.ITAD_API_KEY;
  if (!key) return null;

  try {
    const game = await lookupGame(steamAppId, key);
    if (!game) return null;

    const res = await fetch(`${ITAD_BASE}/games/historylow/v1?key=${key}&country=JP`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([game.id]),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = await res.json();
    const low = Array.isArray(data) ? data[0]?.low : null;
    if (!low) return null;

    return {
      slug: game.slug,
      pageUrl: `https://isthereanydeal.com/game/${game.slug}/info/`,
      lowPrice: low.price?.amount ?? 0,
      lowShopName: low.shop?.name ?? "不明",
      lowCut: low.cut ?? 0,
    };
  } catch {
    return null;
  }
}
