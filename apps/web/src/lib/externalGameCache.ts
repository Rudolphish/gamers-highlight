import { db } from "./db";
import { getSteamAppSummary } from "./steam";
import { getGameplayVideo, YOUTUBE_BACKFILL_BUDGET } from "./youtube";
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
async function fetchExternal(
  steamAppId: number,
  title: string,
  // 引き直したいソースだけを指定する。埋まっている項目を取り直さないことで、
  // 特にYouTube（search.listは1回100ユニット、無料枠は実質100検索/日）の消費を抑える。
  need: Record<ExternalSource, boolean> = { steam: true, youtube: true, hltb: true },
  // 埋め直し（ユーザーが待っていない取得）のときは、YouTubeの枠を半分までに抑える
  youtubeBudget?: number
): Promise<FetchOutcome> {
  const emptySteam = { genres: [] as string[], headerImage: null, name: null };
  const [steam, video] = await Promise.all([
    // HowLongToBeatに渡す英語名が要るので、hltbを引くならSteamも引く
    need.steam || need.hltb
      ? getSteamAppSummary(steamAppId).catch(() => emptySteam)
      : Promise.resolve(emptySteam),
    need.youtube ? getGameplayVideo(title, youtubeBudget).catch(() => null) : Promise.resolve(null),
  ]);

  const hltb = need.hltb ? await getHowLongToBeat(steam.name ?? title).catch(() => null) : null;

  const missing: ExternalSource[] = [];
  // appdetailsが成功していれば必ずnameが入るので、これをSteam側の成否判定に使う
  if (need.steam && steam.name === null) missing.push("steam");
  if (need.youtube && video === null) missing.push("youtube");
  if (need.hltb && hltb === null) missing.push("hltb");

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
 * 取れていない項目だけを引き直す間隔。
 *
 * 埋まっている項目は取り直さない（`fetchExternal`の`need`）ので、この間隔で再試行しても
 * 消費するのは「前回落ちていたソース」の分だけになる。YouTubeが取れているゲームなら
 * 何度来てもYouTubeのクォータは減らない。
 *
 * 通常のリフレッシュ（24時間）より短くしているのは、**失敗が24時間固定されるのを避けるため**。
 * HowLongToBeatは非公式スクレイピングで一時的に落ちるのが前提、YouTubeも無料枠が
 * 実質100検索/日で日をまたげば回復する。「たまたま落ちている時に追加した」だけで
 * 丸一日空欄のままになるのは、原因が外部にあるぶん余計に分かりにくい。
 */
export const RETRY_MISSING_INTERVAL_MS = 6 * 60 * 60 * 1000;

type CacheRow = {
  genres: string[];
  headerImage: string | null;
  youtubeVideoId: string | null;
  hltbGameId: number | null;
};

/** キャッシュ行のうち、まだ値が入っていないソース */
export function missingSources(row: CacheRow): ExternalSource[] {
  const missing: ExternalSource[] = [];
  if (row.genres.length === 0 || row.headerImage === null) missing.push("steam");
  if (row.youtubeVideoId === null) missing.push("youtube");
  if (row.hltbGameId === null) missing.push("hltb");
  return missing;
}

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
    const toRetry = missingSources(cached);
    const elapsed = Date.now() - cached.updatedAt.getTime();

    // **取れなかった項目は「取得済み」ではない。**
    // ここで行の有無だけを見て返していたため、追加した瞬間にYouTubeやHowLongToBeatが
    // 落ちていると、その空欄が焼き付いて復旧後も永久に埋まらなかった
    // （どちらも一時的に失敗するのが普通のサービスなので、これは必ず起きる）。
    // 不足しているソースだけを、間隔を空けて引き直す。
    if (toRetry.length > 0 && elapsed >= RETRY_MISSING_INTERVAL_MS) {
      const need: Record<ExternalSource, boolean> = {
        steam: toRetry.includes("steam"),
        youtube: toRetry.includes("youtube"),
        hltb: toRetry.includes("hltb"),
      };
      const { data: fetched, headerImage: fetchedHeader } = await fetchExternal(
        steamAppId,
        title,
        need,
        YOUTUBE_BACKFILL_BUDGET
      );

      // 取れなかったぶんで既存の値を潰さない（refreshExternalGameDataと同じ方針）
      const merged: ExternalGameData = {
        genres: fetched.genres.length > 0 ? fetched.genres : cached.genres,
        youtubeVideoId: fetched.youtubeVideoId ?? cached.youtubeVideoId,
        hltbGameId: fetched.hltbGameId ?? cached.hltbGameId,
        hltbMainHours: fetched.hltbMainHours ?? cached.hltbMainHours,
        hltbMainExtraHours: fetched.hltbMainExtraHours ?? cached.hltbMainExtraHours,
        hltbCompletionistHours: fetched.hltbCompletionistHours ?? cached.hltbCompletionistHours,
        hltbAllStylesHours: fetched.hltbAllStylesHours ?? cached.hltbAllStylesHours,
      };
      const headerImage = fetchedHeader ?? cached.headerImage;

      await db.externalGameCache.update({
        where: { steamAppId },
        data: { ...merged, headerImage },
      });

      return { ...merged, headerImage };
    }

    return {
      genres: cached.genres,
      youtubeVideoId: cached.youtubeVideoId,
      hltbGameId: cached.hltbGameId,
      hltbMainHours: cached.hltbMainHours,
      hltbMainExtraHours: cached.hltbMainExtraHours,
      hltbCompletionistHours: cached.hltbCompletionistHours,
      hltbAllStylesHours: cached.hltbAllStylesHours,
      headerImage: cached.headerImage,
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
