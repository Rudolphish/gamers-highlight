// SteamストアAPI連携。APIキー不要で使える公開エンドポイントのみ使用する。

export type SteamSearchResult = {
  appId: number;
  name: string;
  thumbnail: string;
};

/** ゲーム名でSteamストアを検索する（Steamストアの検索窓と同じ公開API） */
export async function searchSteamGames(query: string): Promise<SteamSearchResult[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=japanese&cc=jp`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: unknown[] = Array.isArray(data?.items) ? data.items : [];

  return items
    .filter(
      (item): item is { id: number; name: string; tiny_image: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "number"
    )
    .map((item) => ({
      appId: item.id,
      name: item.name,
      thumbnail: item.tiny_image,
    }));
}

/** app IDからストアのヘッダー画像（460x215）のURLを組み立てる */
export function steamHeaderImageUrl(appId: number): string {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}
