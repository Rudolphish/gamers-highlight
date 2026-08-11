// HowLongToBeat.comの非公式スクレイピング（4度目の挑戦、2026-08-08）。公式APIは存在しない。
// 過去3回（npmパッケージ利用、Python版ロジックの移植、検索リンクのみへの後退）はいずれも失敗/断念したが、
// ユーザーが見つけた現行の非公式.NETスクレイパー（codeberg.org/Crashdummy/HowLongToBeatScraper、
// 2026-07-31更新）のソースを参考に、現在実際に動作する手順を確認した上で移植した：
//   1. GET /api/bleed/init?t=<epoch ms>（Refererヘッダー必須）→ token/hpKey/hpValを取得
//   2. POST /api/bleed（x-auth-token等をヘッダーに付与）。ボディにも検索条件に加えて
//      {hpKey}: hpVal という動的な名前のフィールドを追加する必要がある（ここが今回の発見）
// 保守しているメンテナ自身が「先方は時々このエンドポイントを変える」とコメントしており、
// 今後また壊れる前提。失敗時は例外を投げずnullを返す。

const BASE_URL = "https://howlongtobeat.com";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0";
const MIN_SIMILARITY = 0.4;
/** 先方が無応答のときにゲーム追加APIごと道連れにされないための上限 */
const TIMEOUT_MS = 8000;

/**
 * 失敗理由。呼び出し側は結局nullとして扱うが、
 * 「日本語タイトルで0件」なのか「先方の仕様変更でそもそも通信が通らない」のかは
 * ログに残さないと事後に切り分けられない（実際にこれで原因特定が遅れた）。
 */
export type HltbFailure =
  | "init-http-error"
  | "init-bad-shape"
  | "search-http-error"
  | "no-results"
  | "no-match"
  | "no-times"
  | "network-error";

function warn(reason: HltbFailure, title: string, detail?: unknown) {
  console.warn(`[hltb] ${reason} title=${JSON.stringify(title)}`, detail ?? "");
}

type AuthInfo = { token: string; hpKey: string; hpVal: string };

async function getAuth(title: string): Promise<AuthInfo | null> {
  const res = await fetch(`${BASE_URL}/api/bleed/init?t=${Date.now()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*", Referer: `${BASE_URL}/` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    warn("init-http-error", title, res.status);
    return null;
  }
  const data = await res.json();
  if (typeof data?.token !== "string" || typeof data?.hpKey !== "string" || typeof data?.hpVal !== "string") {
    // ここに来たら先方がinitの応答形式を変えた可能性が高い
    warn("init-bad-shape", title, Object.keys(data ?? {}));
    return null;
  }
  return { token: data.token, hpKey: data.hpKey, hpVal: data.hpVal };
}

type RawEntry = {
  game_id?: number;
  game_name?: string;
  game_alias?: string;
  comp_main?: number;
  comp_plus?: number;
  comp_100?: number;
  comp_all?: number;
};

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export type HltbEstimate = {
  gameId: number;
  /** 各項目はデータが無ければnull。全項目nullの場合はgetHowLongToBeat自体がnullを返す */
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
  allStyles: number | null;
};

/**
 * 検索に投げる前のタイトル正規化。
 * Steamの名前には™/®/©が入っていることが多く（"NieR:Automata™" 等）、
 * そのまま検索語にすると先方のヒット率が落ちる。
 */
function normalizeTitle(title: string): string {
  return title
    .replace(/[™®©]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ゲームタイトルからクリア時間の目安（時間単位、小数点1桁）を取得する。見つからない/失敗時はnull。
 *
 * **必ず英語タイトルを渡すこと**。HowLongToBeatは英語タイトルのDBなので、
 * Steamの日本語名（storesearchは`l=japanese`で日本語名を返す）で引くと必ず0件になる。
 * 呼び出し側はappdetailsが返す英語名を使う（lib/externalGameCache.ts参照）。
 */
export async function getHowLongToBeat(rawTitle: string): Promise<HltbEstimate | null> {
  const title = normalizeTitle(rawTitle);
  try {
    const auth = await getAuth(title);
    if (!auth) return null;

    const res = await fetch(`${BASE_URL}/api/bleed`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        "Content-Type": "application/json",
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
        "x-auth-token": auth.token,
        "x-hp-key": auth.hpKey,
        "x-hp-val": auth.hpVal,
      },
      body: JSON.stringify({
        searchType: "games",
        searchTerms: title.split(" ").filter(Boolean),
        searchPage: 1,
        size: 20,
        searchOptions: {
          games: {
            platform: "",
            modifier: "",
            rangeTime: { min: null, max: null },
            gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
            sortCategory: "popular",
          },
        },
        useCache: true,
        [auth.hpKey]: auth.hpVal,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      warn("search-http-error", title, res.status);
      return null;
    }

    const data = await res.json();
    const items: RawEntry[] = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) {
      warn("no-results", title);
      return null;
    }

    let best: RawEntry | null = null;
    let bestScore = -1;
    for (const item of items) {
      const score = Math.max(
        similarity(title, item.game_name ?? ""),
        item.game_alias ? similarity(title, item.game_alias) : 0
      );
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best || bestScore < MIN_SIMILARITY || typeof best.game_id !== "number") {
      warn("no-match", title, { bestScore, candidate: best?.game_name });
      return null;
    }

    // 未収録の項目は0秒で返ってくる。これを0時間として保存すると
    // 「0h」のバーが並ぶうえ、マージ側の `?? existing` を素通りして(0は非nullish)
    // 既にあった正しい値を潰してしまうため、データ無しはnullとして扱う。
    const toHours = (seconds: number | undefined) =>
      typeof seconds === "number" && seconds > 0 ? Math.round((seconds / 3600) * 10) / 10 : null;

    const estimate: HltbEstimate = {
      gameId: best.game_id,
      main: toHours(best.comp_main),
      mainExtra: toHours(best.comp_plus),
      completionist: toHours(best.comp_100),
      allStyles: toHours(best.comp_all),
    };

    if (
      estimate.main === null &&
      estimate.mainExtra === null &&
      estimate.completionist === null &&
      estimate.allStyles === null
    ) {
      // タイトルは一致したが時間データがまだ無い（未発売など）
      warn("no-times", title, best.game_name);
      return null;
    }

    return estimate;
  } catch (e) {
    warn("network-error", title, e instanceof Error ? e.message : e);
    return null;
  }
}
