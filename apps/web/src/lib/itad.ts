// IsThereAnyDeal API連携（過去最安値・比較ページへのリンク）。APIキーが必要（.envのITAD_API_KEY）。
// 公式ドキュメント化された安定したAPIだが、キー未設定の環境でも壊れないようnullで返す。

import { unstable_cache } from "next/cache";
import { gameCacheTag } from "./steam";

const ITAD_BASE = "https://api.isthereanydeal.com";

// Next.js 14ではオプション無しのfetchが既定でキャッシュされ、最安値が固定されたままになる。
// Steam側と同じタグを付け、手動リフレッシュでまとめて無効化できるようにする。
// （POSTのhistorylowはそもそもキャッシュ対象外だが、lookupと同じ再検証期間で揃えておく）
function itadFetchOptions(steamAppId: number): RequestInit {
  return { next: { revalidate: 60 * 60 * 6, tags: [gameCacheTag(steamAppId)] } };
}

/**
 * Steam の app ID から ITAD のゲームIDを引く。ITAD に無いゲームは null。
 * **応答が失敗したときは例外にする**（「無い」と「今は取れない」を分けるため。getSteamStoreLow のキャッシュ参照）。
 * getItadSummary は全体を try/catch しているので、そちらの振る舞いは変わらない
 */
async function lookupGame(steamAppId: number, key: string): Promise<{ id: string; slug: string } | null> {
  const res = await fetch(
    `${ITAD_BASE}/games/lookup/v1?key=${key}&appid=${steamAppId}`,
    itadFetchOptions(steamAppId)
  );
  if (!res.ok) throw new Error(`[itad] lookup ${res.status}`);
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

/** ITAD でのSteamのショップID */
export const ITAD_STEAM_SHOP_ID = 61;

/**
 * `/games/prices/v3` の応答から、Steamでの過去最安値（`storeLow`）を取り出す。形が違えば null。
 * **この問い合わせは本番より前に実物で確かめられていない**（開発環境から ITAD に繋がらない）ので、
 * 形が想定と違ったときに気づけるよう、配列でない応答だけはログに出す
 */
export function parseSteamStoreLow(data: unknown, itadGameId: string): number | null {
  if (!Array.isArray(data)) {
    console.warn("[itad] prices: unexpected response shape");
    return null;
  }
  const entry = data.find((e) => e?.id === itadGameId) ?? null;
  const deals: unknown = entry?.deals;
  if (!Array.isArray(deals)) return null;
  const steam = deals.find((d) => d?.shop?.id === ITAD_STEAM_SHOP_ID);
  const amount = steam?.storeLow?.amount;
  return typeof amount === "number" ? amount : null;
}

/**
 * **Steamだけ**の過去最安値（円）。ウィッシュリストのカードで、Steamの今の値段と並べて出す（ユーザー判断）。
 * ゲーム詳細の価格欄と最安値の通知は全ストア横断（getItadSummary）のままで、こちらとは数字が違いうる。
 *
 * 6時間キャッシュする。ゲーム詳細と同じタグなので、手動リフレッシュで一緒に新しくなる。
 * **取れなかったときはキャッシュしない**（例外で抜ける）。キャッシュすると、たまたま ITAD が落ちていた
 * 6時間はずっと最安値が出なくなる（CLAUDE.md「失敗を『取得済み』として保存してはいけない」）。
 * ITAD に無いゲーム・Steamで売っていないゲームは null を正当な結果としてキャッシュする
 */
export async function getSteamStoreLow(steamAppId: number): Promise<number | null> {
  const key = process.env.ITAD_API_KEY;
  if (!key) return null;

  const load = unstable_cache(
    async (): Promise<number | null> => {
      const game = await lookupGame(steamAppId, key);
      if (!game) return null;
      const res = await fetch(
        `${ITAD_BASE}/games/prices/v3?key=${key}&country=JP&shops=${ITAD_STEAM_SHOP_ID}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([game.id]),
          cache: "no-store",
        }
      );
      if (!res.ok) throw new Error(`[itad] prices ${res.status}`);
      return parseSteamStoreLow(await res.json(), game.id);
    },
    ["itad-steam-store-low", String(steamAppId)],
    { revalidate: 60 * 60 * 6, tags: [gameCacheTag(steamAppId)] }
  );

  try {
    return await load();
  } catch (e) {
    console.warn("[itad] steam store low failed", steamAppId, e instanceof Error ? e.message : e);
    return null;
  }
}
