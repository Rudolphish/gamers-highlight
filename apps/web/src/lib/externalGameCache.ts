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

/** 手動リフレッシュの結果表示に使う、取得できなかった外部ソースの識別子 */
export type ExternalSource = "steam" | "youtube" | "hltb";

export const EXTERNAL_SOURCE_LABEL: Record<ExternalSource, string> = {
  steam: "Steam",
  youtube: "YouTube",
  hltb: "HowLongToBeat",
};

type FetchOutcome = {
  data: ExternalGameData;
  headerImage: string | null;
  /** 値が得られなかったソース。「障害」と「そもそも該当が無い」は区別しない */
  missing: ExternalSource[];
};

/**
 * 外部3サービスを引く共通部分。
 *
 * HowLongToBeatだけはSteamの結果を待ってから引く必要がある：先方は英語タイトルのDBで、
 * `GroupGame.title`はSteam検索（`l=japanese`）由来の日本語名なので、そのまま渡すと
 * 「モンスターハンター：ワールド」のようなクエリになって必ず0件になる。
 * appdetailsが返す英語名を使う（この問い合わせはどのみちジャンル/ヘッダー画像のために行っている）。
 * YouTubeは逆に日本語タイトルで引いた方が実況動画が当たるため、表示用タイトルのまま並行実行する。
 */
async function fetchExternal(steamAppId: number, title: string): Promise<FetchOutcome> {
  const [steam, video] = await Promise.all([
    getSteamAppSummary(steamAppId).catch(() => ({ genres: [] as string[], headerImage: null, name: null })),
    getGameplayVideo(title).catch(() => null),
  ]);

  const hltb = await getHowLongToBeat(steam.name ?? title).catch(() => null);

  const missing: ExternalSource[] = [];
  // appdetailsが成功していれば必ずnameが入るので、これをSteam側の成否判定に使う
  if (steam.name === null) missing.push("steam");
  if (video === null) missing.push("youtube");
  if (hltb === null) missing.push("hltb");

  return {
    data: {
      genres: steam.genres,
      youtubeVideoId: video?.videoId ?? null,
      hltbGameId: hltb?.gameId ?? null,
      hltbMainHours: hltb?.main ?? null,
      hltbMainExtraHours: hltb?.mainExtra ?? null,
      hltbCompletionistHours: hltb?.completionist ?? null,
      hltbAllStylesHours: hltb?.allStyles ?? null,
    },
    headerImage: steam.headerImage,
    missing,
  };
}

/**
 * Steam/YouTube/HowLongToBeatの情報をsteamAppId単位でキャッシュしつつ取得する。
 * GroupGameはグループ単位のレコードのため、複数グループが同じSteamゲームを
 * 追加/提案採用すると、キャッシュが無ければこれらの外部APIへ毎回問い合わせが発生していた。
 * 2回目以降はキャッシュを返すだけで済ませる（特にYouTube search.listはクォータが厳しいため効果が大きい）。
 */
/** 手動リフレッシュの間隔。ExternalGameCacheはグループ横断で共有されるため、この制限も共有される */
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * キャッシュを無視して外部APIを引き直し、保存し直す（手動リフレッシュ用）。
 * 呼び出し側で間隔制限を判定してから呼ぶこと。
 */
export async function refreshExternalGameData(
  steamAppId: number,
  title: string
): Promise<ExternalGameResult & { missing: ExternalSource[] }> {
  // 取得に失敗した項目で既存の値を潰さない（一時的な障害で情報が消えるのを防ぐ）
  const { data: result, headerImage: fetchedHeader, missing } = await fetchExternal(steamAppId, title);

  const existing = await db.externalGameCache.findUnique({ where: { steamAppId } });
  const merged: ExternalGameData = existing
    ? {
        genres: result.genres.length > 0 ? result.genres : existing.genres,
        youtubeVideoId: result.youtubeVideoId ?? existing.youtubeVideoId,
        hltbGameId: result.hltbGameId ?? existing.hltbGameId,
        hltbMainHours: result.hltbMainHours ?? existing.hltbMainHours,
        hltbMainExtraHours: result.hltbMainExtraHours ?? existing.hltbMainExtraHours,
        hltbCompletionistHours: result.hltbCompletionistHours ?? existing.hltbCompletionistHours,
        hltbAllStylesHours: result.hltbAllStylesHours ?? existing.hltbAllStylesHours,
      }
    : result;
  const headerImage = fetchedHeader ?? existing?.headerImage ?? null;

  await db.externalGameCache.upsert({
    where: { steamAppId },
    create: { steamAppId, ...merged, headerImage },
    update: { ...merged, headerImage },
  });

  return { ...merged, headerImage, missing };
}

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
      headerImage = (await getSteamAppSummary(steamAppId).catch(() => ({ headerImage: null })))
        .headerImage;
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

  const { data: result, headerImage } = await fetchExternal(steamAppId, title);

  await db.externalGameCache.upsert({
    where: { steamAppId },
    create: { steamAppId, ...result, headerImage },
    update: { ...result, headerImage },
  });

  return { ...result, headerImage };
}
