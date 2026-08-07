// IsThereAnyDeal API連携（価格の値動き履歴）。APIキーが必要（.envのITAD_API_KEY）。
// 公式ドキュメント化された安定したAPIだが、キー未設定の環境でも壊れないようnullで返す。

const ITAD_BASE = "https://api.isthereanydeal.com";

async function lookupGameId(steamAppId: number, key: string): Promise<string | null> {
  const res = await fetch(`${ITAD_BASE}/games/lookup/v1?key=${key}&appid=${steamAppId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.found ? data.game?.id ?? null : null;
}

export type PriceHistoryPoint = {
  timestamp: string; // ISO 8601
  price: number;
  regular: number;
  cut: number;
};

/** 過去1年のSteam価格変動履歴を古い順で返す。キー未設定/データ無しはnull */
export async function getPriceHistory(steamAppId: number): Promise<PriceHistoryPoint[] | null> {
  const key = process.env.ITAD_API_KEY;
  if (!key) return null;

  try {
    const gameId = await lookupGameId(steamAppId, key);
    if (!gameId) return null;

    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const url = `${ITAD_BASE}/games/history/v2?key=${key}&id=${gameId}&country=JP&shops=61&since=${encodeURIComponent(since)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const points: PriceHistoryPoint[] = data.map((item) => ({
      timestamp: item.timestamp,
      price: item.deal?.price?.amount ?? 0,
      regular: item.deal?.regular?.amount ?? 0,
      cut: item.deal?.cut ?? 0,
    }));

    return points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  } catch {
    return null;
  }
}
