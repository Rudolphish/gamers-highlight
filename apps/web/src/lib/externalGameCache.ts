import { db } from "./db";
import { getSteamAppSummary } from "./steam";
import { getGameplayVideo } from "./youtube";
import { getHowLongToBeat } from "./hltb";

// GroupGameの列にそのまま流し込む部分。headerImageはGroupGame側に同名の列が無く
// coverUrlとして扱うため、意図的にここには含めない（下のExternalGameResultで別に返す）。
export type ExternalGameData = {
  genres: string[];
  youtubeVideoId: string | null;
  hltbGameId: number | null;
  hltbMainHours: number | null;
  hltbMainExtraHours: number | null;
  hltbCompletionistHours: number | null;
  hltbAllStylesHours: number | null;
};

export type ExternalGameResult = ExternalGameData & {
  /** appdetails由来の正しいヘッダー画像URL。取得できなければnull */
  headerImage: string | null;
};

/**
 * Steam/YouTube/HowLongToBeatの情報をsteamAppId単位でキャッシュしつつ取得する。
 * GroupGameはグループ単位のレコードのため、複数グループが同じSteamゲームを
 * 追加/提案採用すると、キャッシュが無ければこれらの外部APIへ毎回問い合わせが発生していた。
 * 2回目以降はキャッシュを返すだけで済ませる（特にYouTube search.listはクォータが厳しいため効果が大きい）。
 */
export async function getOrFetchExternalGameData(
  steamAppId: number,
  title: string
): Promise<ExternalGameResult> {
  const cached = await db.externalGameCache.findUnique({ where: { steamAppId } });
  if (cached) {
    // headerImageは後から追加した列なので、それ以前に作られたキャッシュ行はnullのまま。
    // 何もしないとキャッシュがある限り永久に埋まらないため、ここで不足分だけ取りに行く
    // （appdetailsへの1回の問い合わせで済み、次回以降はキャッシュから返る）。
    let headerImage = cached.headerImage;
    if (headerImage === null) {
      headerImage = (await getSteamAppSummary(steamAppId).catch(() => ({ headerImage: null }))).headerImage;
      if (headerImage !== null) {
        await db.externalGameCache.update({ where: { steamAppId }, data: { headerImage } });
      }
    }

    return {
      genres: cached.genres,
      youtubeVideoId: cached.youtubeVideoId,
      hltbGameId: cached.hltbGameId,
      hltbMainHours: cached.hltbMainHours,
      hltbMainExtraHours: cached.hltbMainExtraHours,
      hltbCompletionistHours: cached.hltbCompletionistHours,
      hltbAllStylesHours: cached.hltbAllStylesHours,
      headerImage,
    };
  }

  const [steam, video, hltb] = await Promise.all([
    getSteamAppSummary(steamAppId).catch(() => ({ genres: [], headerImage: null })),
    getGameplayVideo(title).catch(() => null),
    getHowLongToBeat(title).catch(() => null),
  ]);

  const result: ExternalGameData = {
    genres: steam.genres,
    youtubeVideoId: video?.videoId ?? null,
    hltbGameId: hltb?.gameId ?? null,
    hltbMainHours: hltb?.main ?? null,
    hltbMainExtraHours: hltb?.mainExtra ?? null,
    hltbCompletionistHours: hltb?.completionist ?? null,
    hltbAllStylesHours: hltb?.allStyles ?? null,
  };

  await db.externalGameCache.upsert({
    where: { steamAppId },
    create: { steamAppId, ...result, headerImage: steam.headerImage },
    update: { ...result, headerImage: steam.headerImage },
  });

  return { ...result, headerImage: steam.headerImage };
}
