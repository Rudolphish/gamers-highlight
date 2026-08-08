import { db } from "./db";
import { getSteamGenres } from "./steam";
import { getGameplayVideo } from "./youtube";
import { getHowLongToBeat } from "./hltb";

export type ExternalGameData = {
  genres: string[];
  youtubeVideoId: string | null;
  hltbGameId: number | null;
  hltbMainHours: number | null;
  hltbMainExtraHours: number | null;
  hltbCompletionistHours: number | null;
  hltbAllStylesHours: number | null;
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
): Promise<ExternalGameData> {
  const cached = await db.externalGameCache.findUnique({ where: { steamAppId } });
  if (cached) {
    return {
      genres: cached.genres,
      youtubeVideoId: cached.youtubeVideoId,
      hltbGameId: cached.hltbGameId,
      hltbMainHours: cached.hltbMainHours,
      hltbMainExtraHours: cached.hltbMainExtraHours,
      hltbCompletionistHours: cached.hltbCompletionistHours,
      hltbAllStylesHours: cached.hltbAllStylesHours,
    };
  }

  const [genres, video, hltb] = await Promise.all([
    getSteamGenres(steamAppId).catch(() => []),
    getGameplayVideo(title).catch(() => null),
    getHowLongToBeat(title).catch(() => null),
  ]);

  const result: ExternalGameData = {
    genres,
    youtubeVideoId: video?.videoId ?? null,
    hltbGameId: hltb?.gameId ?? null,
    hltbMainHours: hltb?.main ?? null,
    hltbMainExtraHours: hltb?.mainExtra ?? null,
    hltbCompletionistHours: hltb?.completionist ?? null,
    hltbAllStylesHours: hltb?.allStyles ?? null,
  };

  await db.externalGameCache.upsert({
    where: { steamAppId },
    create: { steamAppId, ...result },
    update: result,
  });

  return result;
}
