// 外部API（Steam / ITAD / YouTube / HowLongToBeat / Discord）を差し替えるプリロード。
// NODE_OPTIONS="--require $PWD/tools/local-test/fetch-stub.cjs" で next start に読ませる。
// 127.0.0.1 と localhost はそのまま通す（内部APIとモックR2のため）。
const realFetch = globalThis.fetch;

const calls = [];
globalThis.__stubCalls = calls;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const APP_NAMES = {
  1245620: { ja: "ELDEN RING", en: "ELDEN RING" },
  271590: { ja: "グランド・セフト・オートV", en: "Grand Theft Auto V" },
  570: { ja: "Dota 2", en: "Dota 2" },
  1091500: { ja: "サイバーパンク2077", en: "Cyberpunk 2077" },
};

function appdetails(url) {
  const appid = Number(new URL(url).searchParams.get("appids"));
  const ja = new URL(url).searchParams.get("l") === "japanese";
  const names = APP_NAMES[appid];
  if (!names) return json({ [String(appid)]: { success: false } });
  return json({
    [String(appid)]: {
      success: true,
      data: {
        name: ja ? names.ja : names.en,
        is_free: appid === 570,
        // 実物と同じく store_item_assets 配下（固定パスの組み立てでは当たらない形）
        header_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/abc123/header.jpg`,
        genres: [
          { id: "1", description: "Action" },
          { id: "3", description: "RPG" },
        ],
        price_overview:
          appid === 570
            ? undefined
            : {
                final_formatted: "¥ 4,730",
                initial_formatted: "¥ 8,600",
                discount_percent: 45,
              },
      },
    },
  });
}

function storesearch(url) {
  const term = new URL(url).searchParams.get("term") ?? "";
  return json({
    total: 3,
    items: [
      {
        id: 1245620,
        name: "ELDEN RING",
        type: "app",
        tiny_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule.jpg",
      },
      // ゲーム以外（パッケージ・バンドル）。採用してはいけない側
      { id: 999001, name: `${term} パッケージ`, type: "sub", tiny_image: "https://example.com/sub.jpg" },
      { id: 999002, name: `${term} バンドル`, type: "bundle", tiny_image: "https://example.com/bundle.jpg" },
    ],
  });
}

function appreviews() {
  return json({
    success: 1,
    query_summary: {
      review_score_desc: "非常に好評",
      total_positive: 12345,
      total_negative: 678,
      total_reviews: 13023,
    },
    reviews: [
      {
        recommendationid: "r1",
        voted_up: true,
        review: "[b]最高[/b]のゲーム<br>おすすめ",
        timestamp_created: 1750000000,
        author: { playtime_forever: 6000 },
      },
      {
        recommendationid: "r2",
        voted_up: false,
        review: "難しすぎる",
        timestamp_created: 1749000000,
        author: { playtime_forever: 120 },
      },
    ],
  });
}

function steamNews() {
  return json({
    appnews: {
      newsitems: [
        {
          gid: "n1",
          title: "パッチ 1.16 配信",
          url: "https://store.steampowered.com/news/app/1245620/view/1",
          date: 1755000000,
          contents: "不具合を修正しました",
        },
      ],
    },
  });
}

function itad(url) {
  if (url.includes("/games/lookup/")) {
    return json({ found: true, game: { id: "itad-game-id", slug: "elden-ring" } });
  }
  if (url.includes("/games/historylow/")) {
    return json([{ low: { price: { amount: 3200 }, shop: { name: "Steam" }, cut: 60 } }]);
  }
  return json({}, 404);
}

function youtube() {
  return json({
    items: [{ id: { videoId: "stubVideoId" }, snippet: { title: "スタブのプレイ動画" } }],
  });
}

function hltb(url, init) {
  if (url.includes("/api/bleed/init")) {
    return json({ token: "stub-token", hpKey: "stubHpKey", hpVal: "stub-hp-val" });
  }
  if (url.includes("/api/bleed")) {
    // 実物と同じく検索語に対して返す。ここを固定名にすると類似度judgeで弾かれる
    let searched = "Elden Ring";
    try {
      const body = JSON.parse(init?.body ?? "{}");
      if (Array.isArray(body.searchTerms) && body.searchTerms.length > 0) {
        searched = body.searchTerms.join(" ");
      }
      globalThis.__lastHltbBody = body;
    } catch {}
    return json({
      data: [
        {
          game_id: 68151,
          game_name: searched,
          game_alias: "",
          comp_main: 200000,
          comp_plus: 360000,
          comp_100: 470000,
          comp_all: 300000,
        },
      ],
    });
  }
  return json({}, 404);
}

function discord(url, init) {
  return json({ id: "stub-message-id", channel_id: "stub-channel" });
}

// 1x1の透過PNG。next/imageはサーバー側から画像を取りに行くので、
// これを返さないと「外部呼び出しが未処理」としてブラウザ側に500系が出る。
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function image() {
  return new Response(TINY_PNG, {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(TINY_PNG.length) },
  });
}

globalThis.fetch = async function stubbedFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return realFetch(input, init);
  }

  if (host === "127.0.0.1" || host === "localhost") return realFetch(input, init);

  calls.push({ url, method: init?.method ?? "GET" });

  // テスト側から「外部を何回引いたか」を見るための記録（クォータ節約が効いているかの確認用）。
  // サーバーとテストは別プロセスなので、ファイル経由で渡す。
  try {
    require("node:fs").appendFileSync("/tmp/stub-calls.log", `${host}\n`);
  } catch {}

  // 外部が落ちている状況を再現する。/tmp/stub-fail にホスト名を書くとそのホストが500を返す
  // （1件の取得失敗でページ全体が落ちないかの確認用）。
  try {
    const failing = require("node:fs").readFileSync("/tmp/stub-fail", "utf8");
    if (failing.trim() === "*" || failing.split(/\s+/).includes(host)) {
      return new Response("upstream is down", { status: 500 });
    }
  } catch {}

  try {
    // 画像のホスト（next/imageがサーバー側から取りに行く先）
    if (
      host.endsWith(".steamstatic.com") ||
      host.endsWith(".akamaihd.net") ||
      host === "cdn.discordapp.com" ||
      host === "images.unsplash.com"
    ) {
      return image();
    }
    if (host === "store.steampowered.com") {
      if (url.includes("/api/appdetails")) return appdetails(url);
      if (url.includes("/api/storesearch")) return storesearch(url);
      if (url.includes("/appreviews/")) return appreviews();
    }
    if (host === "api.steampowered.com") return steamNews();
    if (host === "api.isthereanydeal.com") return itad(url);
    if (host === "www.googleapis.com") return youtube();
    if (host === "howlongtobeat.com") return hltb(url, init);
    if (host === "discord.com") return discord(url, init);
  } catch (e) {
    console.error("[stub] handler error", url, e);
  }

  // 想定外の外部呼び出しは目に見える形で落とす（見落とすと本番だけ壊れる）
  console.warn(`[stub] unhandled external fetch: ${url}`);
  return json({ error: "unhandled by stub" }, 599);
};
