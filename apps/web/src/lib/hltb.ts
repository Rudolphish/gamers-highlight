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

type AuthInfo = { token: string; hpKey: string; hpVal: string };

async function getAuth(): Promise<AuthInfo | null> {
  const res = await fetch(`${BASE_URL}/api/bleed/init?t=${Date.now()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*", Referer: `${BASE_URL}/` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (typeof data?.token !== "string" || typeof data?.hpKey !== "string" || typeof data?.hpVal !== "string") {
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
  main: number;
  mainExtra: number;
  completionist: number;
  allStyles: number;
};

/** ゲームタイトルからクリア時間の目安（時間単位、小数点1桁）を取得する。見つからない/失敗時はnull */
export async function getHowLongToBeat(title: string): Promise<HltbEstimate | null> {
  try {
    const auth = await getAuth();
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
    });
    if (!res.ok) return null;

    const data = await res.json();
    const items: RawEntry[] = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) return null;

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
    if (!best || bestScore < MIN_SIMILARITY || typeof best.game_id !== "number") return null;

    const toHours = (seconds: number | undefined) => Math.round(((seconds ?? 0) / 3600) * 10) / 10;

    return {
      gameId: best.game_id,
      main: toHours(best.comp_main),
      mainExtra: toHours(best.comp_plus),
      completionist: toHours(best.comp_100),
      allStyles: toHours(best.comp_all),
    };
  } catch {
    return null;
  }
}
