import { db } from "./db";
import { steamHeaderImageUrl, getSteamAppSummary } from "./steam";

/**
 * アルバムにSteamのゲームを紐付けたときに、正しいサムネイルURLを控えておく。
 *
 * ここで取っておかないと、まだゲームリストに無いゲーム（新しいグループで
 * 空のアルバムを作って連携しただけ、など）は参照先が無く、組み立てURLに落ちて
 * **新しいタイトルでは空サムネイルになる**（実際に起きた）。
 *
 * 引くのは appdetails 1回だけ。YouTubeやHowLongToBeatには触らない
 * （YouTubeは検索1回で無料枠の1%を使うため、この用途で呼んではいけない）。
 * 失敗しても連携自体は成功させる。次に誰かがゲームを追加した時点で埋まる。
 */
export async function cacheSteamHeaderImage(steamAppId: number): Promise<void> {
  try {
    const existing = await db.externalGameCache.findUnique({
      where: { steamAppId },
      select: { headerImage: true },
    });
    if (existing?.headerImage) return;

    const { headerImage, genres } = await getSteamAppSummary(steamAppId);
    if (!headerImage) return;

    await db.externalGameCache.upsert({
      where: { steamAppId },
      create: { steamAppId, headerImage, genres },
      update: { headerImage },
    });
  } catch (e) {
    console.error("[albumCover] ヘッダー画像を控えられなかった", e);
  }
}

/**
 * Steam連携したアルバムのサムネイルURLを引く。
 *
 * **`steamHeaderImageUrl()` を単独で使ってはいけない。** あれは
 * `steam/apps/<id>/header.jpg` を組み立てるだけで、Steamがアセットを
 * `store_item_assets/steam/apps/<id>/<ハッシュ>/header.jpg` へ移して以降、
 * **新しいタイトルでは404になる**（実際にアルバム一覧で空サムネイルになった）。
 *
 * appdetails由来の正しいURLは、ゲームリスト（GroupGame.coverUrl）か
 * 外部データのキャッシュ（ExternalGameCache.headerImage）に入っているので、
 * まずそちらを見る。どちらにも無い場合だけ、旧パスの組み立てに落とす
 * （古いタイトルは今もこれで通るため、何も出さないよりはよい）。
 */
export async function getSteamCoverUrls(
  appIds: (number | null | undefined)[]
): Promise<Map<number, string>> {
  const ids = [...new Set(appIds.filter((id): id is number => typeof id === "number"))];
  const covers = new Map<number, string>();
  if (ids.length === 0) return covers;

  const [caches, games] = await Promise.all([
    db.externalGameCache.findMany({
      where: { steamAppId: { in: ids }, headerImage: { not: null } },
      select: { steamAppId: true, headerImage: true },
    }),
    db.groupGame.findMany({
      where: { steamAppId: { in: ids }, coverUrl: { not: null } },
      select: { steamAppId: true, coverUrl: true },
    }),
  ]);

  for (const g of games) {
    if (g.coverUrl) covers.set(g.steamAppId, g.coverUrl);
  }
  // キャッシュの方がappdetails直伝なので、あれば上書きする
  for (const c of caches) {
    if (c.headerImage) covers.set(c.steamAppId, c.headerImage);
  }

  for (const id of ids) {
    if (!covers.has(id)) covers.set(id, steamHeaderImageUrl(id));
  }

  return covers;
}
