// 主要な導線を実際に通して、DBの状態まで確認する統合テスト。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeResults } from "./_results.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "local-internal-secret";
const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron-secret";
const db = new PrismaClient();

const results = [];
/** name は「F01 説明」の形。IDと項目名に分けて記録する */
function check(name, ok, detail = "") {
  const [, id, item] = name.match(/^(\S+)\s+(.*)$/) ?? [null, name, name];
  results.push({ id, item, expected: "成功", actual: ok ? "成功" : "失敗", ok, note: ok ? "" : String(detail).slice(0, 160) });
  if (!ok) console.log(`NG: ${name} — ${String(detail).slice(0, 300)}`);
}

async function cookieFor(email) {
  const token = await encode({ token: { name: email, email, sub: email }, secret: SECRET, maxAge: 3600 });
  return `next-auth.session-token=${token}`;
}

async function api(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const adminCookie = await cookieFor("admin@example.com");
const memberCookie = await cookieFor("member@example.com");
const outsiderCookie = await cookieFor("outsider@example.com");

const group = await db.group.findFirst({ where: { name: "テストグループ" } });
const album = await db.album.findFirst({ where: { title: "エルデンリング" } });

// ───────────────────────────────────────────────────────────
// A. アップロード（署名付きPUT → ストレージ → レコード作成）
// ───────────────────────────────────────────────────────────
{
  const bytes = Buffer.from("fake-png-bytes-0123456789");
  const signed = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", mediaType: "IMAGE", sizeBytes: bytes.length },
  });
  check("F01 署名付きURLが発行される", signed.status === 201 && !!signed.json?.upload?.url, signed.text);

  const signedUrl = signed.json?.upload?.url ?? "";
  check(
    "F02 署名にチェックサムが混入していない（x-amz-checksum-）",
    !signedUrl.includes("x-amz-checksum-"),
    signedUrl
  );
  check("F03 署名付きPUTである（POSTポリシーではない）", !!signed.json?.upload?.url && !signed.json?.upload?.fields, JSON.stringify(signed.json?.upload ?? {}));

  // 実際にストレージへPUTする
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": "image/png", "content-length": String(bytes.length) },
    body: bytes,
  });
  check("F04 ストレージへの署名付きPUTが通る", put.status === 200, put.status);

  // サイズ上限はcontent-lengthを署名対象に入れることで担保している。
  // モックは署名検証をしないので、SignedHeadersに含まれていることで確認する。
  check(
    "F05 content-lengthが署名対象に含まれる（サイズ上限の担保）",
    /X-Amz-SignedHeaders=[^&]*content-length/i.test(signedUrl),
    signedUrl.match(/X-Amz-SignedHeaders=[^&]*/i)?.[0]
  );

  // R2はPOSTに501を返す（CORSヘッダー無し）: モックが本番と同じ壊れ方をすること
  const post = await fetch(signed.json.publicUrl, { method: "POST", body: bytes });
  check("F06 POSTは501（R2非対応の再現）", post.status === 501, post.status);

  const created = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: {
      contentType: "image/png",
      mediaUrl: signed.json.publicUrl,
      sizeBytes: bytes.length,
      albumId: album.id,
      gameTitle: "ELDEN RING",
      capturedAt: "2026-08-10T12:00:00Z",
    },
  });
  check("F07 アップロード後にPhotoが作られる", created.status === 201, created.text);

  // 自前ストレージ外のURLは拒否されること
  const foreign = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", mediaUrl: "https://evil.example.com/x.png", albumId: album.id },
  });
  check("F08 外部URLのmediaUrlは400で拒否", foreign.status === 400, foreign.text);

  // 他人のアルバムへは投稿できないこと
  const otherAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });
  const intrude = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", mediaUrl: signed.json.publicUrl, albumId: otherAlbum.id },
  });
  check("F09 権限の無いアルバムへの投稿は403", intrude.status === 403, intrude.text);

  // グループ共有アルバム（オーナーが別人）へメンバーが投稿できること（#34の修正）
  const signed2 = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: memberCookie,
    body: { contentType: "image/png", sizeBytes: 10 },
  });
  const shared = await api("/api/photos", {
    method: "POST",
    cookie: memberCookie,
    body: { contentType: "image/png", mediaUrl: signed2.json.publicUrl, albumId: album.id },
  });
  check("F10 共有アルバムへメンバーが投稿できる（#34）", shared.status === 201, shared.text);

  // 動画の上限
  const tooLong = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: 100, durationSeconds: 99999 },
  });
  check("F11 長すぎる動画は413", tooLong.status === 413, tooLong.status);
}

// ───────────────────────────────────────────────────────────
// B. 招待リンク
// ───────────────────────────────────────────────────────────
{
  // 発行はOWNERのみ（member=EDITORは不可）
  const byMember = await api(`/api/groups/${group.id}/invites`, {
    method: "POST",
    cookie: memberCookie,
    body: { role: "VIEWER", maxUses: 1, expiresInHours: 24 },
  });
  check("F12 OWNER以外は招待リンクを発行できない", byMember.status === 403, byMember.text);

  const issued = await api(`/api/groups/${group.id}/invites`, {
    method: "POST",
    cookie: adminCookie,
    body: { role: "VIEWER", maxUses: 1, expiresInHours: 24 },
  });
  check("F13 OWNERは招待リンクを発行できる", issued.status === 200 || issued.status === 201, issued.text);
  const token = issued.json?.invite?.token;

  // claim: ログイン前にCookieへ載せる経路
  const claim = await api(`/api/invites/${token}/claim`, { method: "POST" });
  check("F14 claimが成功する", claim.status === 200, claim.text);

  const expired = await api(`/api/invites/test-invite-expired/claim`, { method: "POST" });
  check("F15 期限切れリンクのclaimは拒否", expired.status >= 400, expired.status);

  const revoked = await api(`/api/invites/test-invite-revoked/claim`, { method: "POST" });
  check("F16 取り消し済みリンクのclaimは拒否", revoked.status >= 400, revoked.status);

  // 加入（accept）: 既存ユーザー（outsider）がリンクでグループに入る
  const accept = await api(`/api/invites/${token}/accept`, { method: "POST", cookie: outsiderCookie });
  check("F17 acceptでグループに加入できる", accept.status === 200, accept.text);

  const outsider = await db.user.findUnique({ where: { email: "outsider@example.com" } });
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId: outsider.id } },
  });
  check("F18 GroupMemberが作られている", !!membership, "membership missing");

  const inviteRow = await db.groupInvite.findUnique({ where: { token } });
  check("F19 usedCountが増えている", (inviteRow?.usedCount ?? 0) >= 1, inviteRow?.usedCount);

  const use = await db.groupInviteUse.findFirst({ where: { inviteId: inviteRow.id, userId: outsider.id } });
  check("F20 使用履歴（GroupInviteUse）が残る", !!use, "use record missing");

  // 上限に達したリンクは以降拒否される
  const again = await api(`/api/invites/${token}/claim`, { method: "POST" });
  check("F21 使用上限に達したリンクは拒否", again.status >= 400, again.status);

  // 後始末（他のテストに影響しないよう部外者を戻す）
  await db.groupMember.deleteMany({ where: { groupId: group.id, userId: outsider.id } });
}

// ───────────────────────────────────────────────────────────
// C. 提案とリアクション（過半数で自動昇格）
// ───────────────────────────────────────────────────────────
{
  const proposal = await db.groupGameProposal.findFirst({ where: { groupId: group.id, status: "PENDING" } });
  const before = await db.groupGame.count({ where: { groupId: group.id } });

  const react = await api(`/api/groups/${group.id}/proposals/${proposal.id}/reactions`, {
    method: "POST",
    cookie: adminCookie,
    body: { type: "LIKE" },
  });
  check("F22 リアクションを付けられる", react.status === 200 || react.status === 201, react.text);

  const updated = await db.groupGameProposal.findUnique({ where: { id: proposal.id } });
  const after = await db.groupGame.count({ where: { groupId: group.id } });
  check(
    "F23 LIKEが過半数に達すると自動でACCEPTED＋GroupGame化",
    updated.status === "ACCEPTED" && after === before + 1,
    `status=${updated.status} games ${before}→${after}`
  );

  const promoted = await db.groupGame.findFirst({ where: { groupId: group.id, steamAppId: proposal.steamAppId } });
  check(
    "F24 昇格したゲームのカバーがappdetails由来（組み立てURLでない）",
    !!promoted?.coverUrl && !promoted.coverUrl.includes("cdn.akamai.steamstatic.com/steam/apps/"),
    promoted?.coverUrl
  );

  // 二重リアクションは1人1件に集約される（@@unique）
  const react2 = await api(`/api/groups/${group.id}/proposals/${proposal.id}/reactions`, {
    method: "POST",
    cookie: adminCookie,
    body: { type: "PASS" },
  });
  const count = await db.groupGameProposalReaction.count({
    where: { proposalId: proposal.id, user: { email: "admin@example.com" } },
  });
  check("F25 同じ人のリアクションは1件のまま", count === 1, `status=${react2.status} count=${count}`);
}

// ───────────────────────────────────────────────────────────
// D. ゲーム追加（Steam検索 → 追加 → 外部データ）
// ───────────────────────────────────────────────────────────
{
  const search = await api("/api/steam/search?q=elden", { cookie: adminCookie });
  const items = search.json?.results ?? search.json?.games ?? search.json?.items ?? [];
  check("F26 Steam検索が結果を返す", search.status === 200 && items.length > 0, search.text);
  check(
    "F27 検索結果からsub/bundleが除外されている",
    Array.isArray(items) && items.every((i) => i.appId !== 999001 && i.appId !== 999002),
    JSON.stringify(items).slice(0, 200)
  );

  const usageBefore = await db.apiUsage.findFirst({ where: { service: "youtube" } });
  const add = await api(`/api/groups/${group.id}/games`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 1091500, title: "サイバーパンク2077" },
  });
  check("F28 ゲームを追加できる", add.status === 200 || add.status === 201, add.text);

  const game = await db.groupGame.findFirst({ where: { groupId: group.id, steamAppId: 1091500 } });
  check(
    "F29 カバー画像がappdetailsのheader_image",
    !!game?.coverUrl && game.coverUrl.includes("store_item_assets"),
    game?.coverUrl
  );
  check("F30 ジャンルが保存される", (game?.genres?.length ?? 0) > 0, game?.genres);
  check("F31 YouTubeの動画IDが1回の検索で保存される", game?.youtubeVideoId === "stubVideoId", game?.youtubeVideoId);
  check("F32 HowLongToBeatの時間が保存される", game?.hltbMainHours != null, game?.hltbMainHours);

  const cache = await db.externalGameCache.findUnique({ where: { steamAppId: 1091500 } });
  check("F33 ExternalGameCacheに載る（2グループ目以降の再取得を防ぐ）", !!cache, "cache missing");

  const usageAfter = await db.apiUsage.findFirst({ where: { service: "youtube" } });
  check(
    "F34 YouTubeのクォータ消費が記録される",
    (usageAfter?.units ?? 0) > (usageBefore?.units ?? 0),
    `${usageBefore?.units ?? 0} → ${usageAfter?.units ?? 0}`
  );

  // 同じゲームの二重追加
  const dup = await api(`/api/groups/${group.id}/games`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 1091500, title: "サイバーパンク2077" },
  });
  check("F35 同じゲームの二重追加は弾かれる", dup.status >= 400, dup.status);

  // 「気になる」
  const interest = await api(`/api/groups/${group.id}/games/${game.id}/interest`, {
    method: "POST",
    cookie: memberCookie,
  });
  check("F36 「気になる」を付けられる", interest.status === 200 || interest.status === 201, interest.text);
}

// ───────────────────────────────────────────────────────────
// E. Discord取り込み（内部API）
// ───────────────────────────────────────────────────────────
{
  const noSecret = await api("/api/discord/ingest", { method: "POST", body: {} });
  check("F37 シークレット無しの取り込みは401", noSecret.status === 401, noSecret.status);

  const payload = {
    discordUserId: "100000000000000002",
    channelId: "700000000000000001",
    guildId: group.guildId,
    attachmentUrl: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
    contentType: "image/png",
    sizeBytes: 1024,
    discordMessageId: `msg-${randomUUID()}`,
    postedAt: new Date().toISOString(),
    rawTag: "eldenring",
    fileName: "1245620_20260810120000_1.png",
  };
  const ingest = await api("/api/discord/ingest", {
    method: "POST",
    body: payload,
    headers: { "x-internal-secret": INTERNAL_SECRET },
  });
  check("F38 Discordからの取り込みが成功する", ingest.status === 200 || ingest.status === 201, ingest.text);

  const photo = await db.photo.findFirst({ where: { discordMessageId: payload.discordMessageId } });
  check("F39 Photoが作られる（source=DISCORD）", photo?.source === "DISCORD", photo?.source ?? "missing");
  check(
    "F40 メディアが自前ストレージへコピーされている",
    !!photo?.mediaUrl?.startsWith("http://127.0.0.1:9100/gh-local/"),
    photo?.mediaUrl
  );

  const tag = await db.discordGameTag.findFirst({ where: { guildId: group.guildId, tag: "eldenring" } });
  check("F41 ハッシュタグからアルバムが自動作成される", !!tag?.autoAlbumId, "tag missing");

  // 同じメッセージの再取り込みで重複しないこと
  const again = await api("/api/discord/ingest", {
    method: "POST",
    body: payload,
    headers: { "x-internal-secret": INTERNAL_SECRET },
  });
  const dupCount = await db.photo.count({ where: { discordMessageId: payload.discordMessageId } });
  check("F42 同じメッセージの再取り込みで重複しない", dupCount === 1, `status=${again.status} count=${dupCount}`);
}

// ───────────────────────────────────────────────────────────
// F. スクショのファイル名からのゲーム判別
// ───────────────────────────────────────────────────────────
{
  // ファイル名の解析（<appId>_<日時>_<連番>）はクライアント側。ここではその結果を渡す
  const identify = await api("/api/photos/identify", {
    method: "POST",
    cookie: adminCookie,
    body: { appIds: [1245620, 1091500] },
  });
  check("F43 判別APIが応答する", identify.status === 200, identify.text);
  const body = JSON.stringify(identify.json ?? {});
  check("F44 app IDがゲーム名とアルバムに解決される", body.includes("1245620") && body.includes("ELDEN RING"), body.slice(0, 300));
  check(
    "F45 判別結果に既存アルバムが紐づく",
    (identify.json?.results ?? []).some((r) => r.albumId || r.album),
    body.slice(0, 300)
  );
}

// ───────────────────────────────────────────────────────────
// G. エラー通報とcron
// ───────────────────────────────────────────────────────────
{
  const anonReport = await api("/api/errors", {
    method: "POST",
    body: { message: "外部からの通報", digest: "anon-digest", path: "/" },
  });
  check("F46 未ログインからのエラー通報は401（通知の埋め立て対策）", anonReport.status === 401, anonReport.status);

  const report = await api("/api/errors", {
    method: "POST",
    cookie: adminCookie,
    body: { message: "総合テストの模擬エラー", digest: "test-digest-1", path: "/albums" },
  });
  check("F47 エラー通報を受け付ける", report.status >= 200 && report.status < 300, report.text);

  const row = await db.errorReport.findFirst({ where: { fingerprint: { contains: "test-digest-1" } } });
  check("F48 ErrorReportに記録される", !!row, "row missing");

  await api("/api/errors", {
    method: "POST",
    cookie: adminCookie,
    body: { message: "総合テストの模擬エラー", digest: "test-digest-1", path: "/albums" },
  });
  const row2 = await db.errorReport.findFirst({ where: { fingerprint: { contains: "test-digest-1" } } });
  check("F49 同じ不具合はcountに集約される", (row2?.count ?? 0) >= 2, row2?.count);

  const cronNoSecret = await api("/api/cron/check-wishlist-prices");
  check("F50 cronはシークレット無しで401", cronNoSecret.status === 401, cronNoSecret.status);

  const cron = await api("/api/cron/check-wishlist-prices", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  check("F51 cron（価格チェック）が完走する", cron.status === 200, cron.text);

  const health = await api("/api/cron/check-bot-health", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  check("F52 cron（Bot死活）が完走する", health.status === 200, health.text);
}

// ───────────────────────────────────────────────────────────
// H. 外部APIが一時的に落ちていた場合の埋め直し
//    （落ちている間に追加したゲームの空欄が焼き付かないこと）
// ───────────────────────────────────────────────────────────
{
  const { writeFileSync, unlinkSync, readFileSync } = await import("node:fs");
  const APP_ID = 570; // Dota 2（他のケースと衝突しないapp ID）

  /** スタブが記録した外部呼び出しの累計（サーバーとは別プロセスなのでファイル経由） */
  const externalCallCount = () => {
    try {
      return readFileSync("/tmp/stub-calls.log", "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };

  await db.groupGame.deleteMany({ where: { steamAppId: APP_ID } });
  await db.externalGameCache.deleteMany({ where: { steamAppId: APP_ID } });

  async function addGame() {
    return api(`/api/groups/${group.id}/games`, {
      method: "POST",
      cookie: adminCookie,
      body: { steamAppId: APP_ID, title: "Dota 2" },
    });
  }

  // YouTubeとHowLongToBeatが落ちている間に追加する
  writeFileSync("/tmp/stub-fail", "www.googleapis.com howlongtobeat.com");
  const added = await addGame();
  const brokenCache = await db.externalGameCache.findUnique({ where: { steamAppId: APP_ID } });
  check(
    "F53 外部が落ちていてもゲーム自体は追加できる",
    (added.status === 200 || added.status === 201) && !!brokenCache,
    added.text
  );
  check(
    "F54 落ちている間は値が入らない（前提の確認）",
    brokenCache?.youtubeVideoId === null && brokenCache?.hltbGameId === null,
    `YT=${brokenCache?.youtubeVideoId} HLTB=${brokenCache?.hltbGameId}`
  );

  // 外部が復旧
  unlinkSync("/tmp/stub-fail");

  // 再試行の間隔を過ぎた状態にする（本番では6時間。テストでは時計を戻す）
  await db.$executeRaw`UPDATE external_game_caches SET "updatedAt" = NOW() - INTERVAL '7 hours' WHERE "steamAppId" = ${APP_ID}`;

  await db.groupGame.deleteMany({ where: { steamAppId: APP_ID } });
  await addGame();
  const healed = await db.externalGameCache.findUnique({ where: { steamAppId: APP_ID } });
  check(
    "F55 復旧後は不足分だけ引き直して埋まる（失敗が焼き付かない）",
    healed?.youtubeVideoId !== null && healed?.hltbGameId !== null,
    `YT=${healed?.youtubeVideoId} HLTB=${healed?.hltbGameId}`
  );

  // 埋まった後は、間隔内なら外部を引かない（クォータ節約が効いていること）。
  // スタブが /tmp/stub-calls.log に外部呼び出しを1行ずつ記録しているのでそれを数える。
  const before = externalCallCount();
  await db.groupGame.deleteMany({ where: { steamAppId: APP_ID } });
  await addGame();
  const spent = externalCallCount() - before;
  check("F56 埋まっているゲームは間隔内なら外部を引かない", spent === 0, `外部呼び出しが ${spent} 回発生した`);

  // 取れていない項目が残っている間は、手動リフレッシュが24時間ロックされない
  await db.externalGameCache.update({
    where: { steamAppId: APP_ID },
    data: { youtubeVideoId: null, hltbGameId: null },
  });
  await db.$executeRaw`UPDATE external_game_caches SET "updatedAt" = NOW() - INTERVAL '7 hours' WHERE "steamAppId" = ${APP_ID}`;
  const game570 = await db.groupGame.findFirst({ where: { groupId: group.id, steamAppId: APP_ID } });
  const refreshed = await api(`/api/groups/${group.id}/games/${game570.id}/refresh`, {
    method: "POST",
    cookie: adminCookie,
  });
  check(
    "F57 未取得が残っていれば6時間で手動リフレッシュできる（429にならない）",
    refreshed.status === 200,
    `${refreshed.status} ${refreshed.text.slice(0, 120)}`
  );

  // 埋め直しはYouTubeの枠を半分までしか使わない（ユーザーの追加操作ぶんを残す）
  await db.apiUsage.upsert({
    where: { service_date: { service: "youtube", date: new Date(new Date().toISOString().slice(0, 10)) } },
    create: { service: "youtube", date: new Date(new Date().toISOString().slice(0, 10)), calls: 60, units: 6000 },
    update: { calls: 60, units: 6000 },
  });
  await db.externalGameCache.update({
    where: { steamAppId: APP_ID },
    data: { youtubeVideoId: null },
  });
  await db.$executeRaw`UPDATE external_game_caches SET "updatedAt" = NOW() - INTERVAL '7 hours' WHERE "steamAppId" = ${APP_ID}`;

  const beforeBudget = externalCallCount();
  await db.groupGame.deleteMany({ where: { steamAppId: APP_ID } });
  await addGame();
  const afterCache = await db.externalGameCache.findUnique({ where: { steamAppId: APP_ID } });
  const usage = await db.apiUsage.findFirst({ where: { service: "youtube" } });
  check(
    "F58 枠を半分使っていたら埋め直しのYouTube検索は行わない",
    afterCache?.youtubeVideoId === null && usage?.units === 6000,
    `YT=${afterCache?.youtubeVideoId} units=${usage?.units} 外部呼び出し=${externalCallCount() - beforeBudget}`
  );
}

// ───────────────────────────────────────────────────────────
// I. セッションにユーザーIDが入る前のトークンでも動くこと
//    （getCurrentUser のDBフォールバック。既存のログインを切らさないため）
// ───────────────────────────────────────────────────────────
{
  const legacyCookie = `next-auth.session-token=${await encode({
    // userId を入れない＝IDを載せる前に発行されたトークンと同じ形
    token: { name: "admin", email: "admin@example.com", sub: "admin@example.com" },
    secret: SECRET,
    maxAge: 3600,
  })}`;

  const page = await api(`/groups/${group.id}`, { cookie: legacyCookie });
  check(
    "F59 旧トークン（userIdなし）でもページが見える",
    page.status === 200 && page.text.includes("テストグループ"),
    `${page.status}`
  );

  const list = await api("/api/groups", { cookie: legacyCookie });
  check("F60 旧トークンでもAPIが通る", list.status === 200, `${list.status} ${list.text.slice(0, 80)}`);

  const denied = await api(`/api/albums/${(await db.album.findFirst({ where: { title: "部外者のアルバム" } })).id}`, {
    cookie: legacyCookie,
  });
  check("F61 旧トークンでも権限判定は効く（他人のアルバムは403）", denied.status === 403, `${denied.status}`);
}

// ───────────────────────────────────────────────────────────
// J. ページのキャッシュ（unstable_cache）
//    「他人のものが見える」と「投稿したのに出ない」の両方を見る
// ───────────────────────────────────────────────────────────
{
  const albumUrl = `/albums/${album.id}`;
  const groupUrl = `/groups/${group.id}`;

  // まず管理者で開いてキャッシュを作る
  const warm = await api(albumUrl, { cookie: adminCookie });
  check("F62 アルバム詳細が開ける（キャッシュ作成）", warm.status === 200 && warm.text.includes("エルデンリング"), warm.status);

  // **2回目（キャッシュヒット）も同じ中身が出ること。**
  // unstable_cache は値をJSONにして保存するので、Dateは文字列に化ける。
  // 1回目は素のDateが返るため通ってしまい、**ヒットした回だけ落ちる**。
  // 実際に capturedAt?.toISOString() がこれで壊れ、1回目しか見ていなかったため見逃した。
  const hit = await api(albumUrl, { cookie: adminCookie });
  check(
    "F62b アルバム詳細はキャッシュヒット時も壊れない",
    hit.status === 200 &&
      hit.text.includes("エルデンリング") &&
      !hit.text.includes("問題が発生しました"),
    `${hit.status} エラー画面=${hit.text.includes("問題が発生しました")}`
  );

  // ── 権限: キャッシュが温まっていても、権限の無い人には出ない ──
  const byOutsider = await api(albumUrl, { cookie: outsiderCookie });
  check(
    "F63 キャッシュ済みでも権限の無い人には出ない",
    !byOutsider.text.includes("エルデンリング") && byOutsider.text.includes("NEXT_NOT_FOUND"),
    `${byOutsider.status}`
  );

  const groupWarm = await api(groupUrl, { cookie: adminCookie });
  check("F64 グループ詳細が開ける（キャッシュ作成）", groupWarm.status === 200 && groupWarm.text.includes("テストグループ"), groupWarm.status);

  const groupHit = await api(groupUrl, { cookie: adminCookie });
  check(
    "F64b グループ詳細はキャッシュヒット時も壊れない",
    groupHit.status === 200 &&
      groupHit.text.includes("テストグループ") &&
      !groupHit.text.includes("問題が発生しました"),
    `${groupHit.status} エラー画面=${groupHit.text.includes("問題が発生しました")}`
  );

  const groupByOutsider = await api(groupUrl, { cookie: outsiderCookie });
  check(
    "F65 グループもキャッシュ済みで権限の無い人には出ない",
    !groupByOutsider.text.includes("テストグループ") && groupByOutsider.text.includes("NEXT_NOT_FOUND"),
    `${groupByOutsider.status}`
  );

  // ── 無効化: 写真を上げたら、次に開いたとき出ていること ──
  const signed = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", sizeBytes: 12 },
  });
  const uploaded = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: {
      contentType: "image/png",
      mediaUrl: signed.json.publicUrl,
      sizeBytes: 12,
      albumId: album.id,
      gameTitle: "キャッシュ確認用",
    },
  });
  const afterUpload = await api(albumUrl, { cookie: adminCookie });
  check(
    "F66 写真を上げたらアルバム詳細に即出る（無効化）",
    uploaded.status === 201 && afterUpload.text.includes(uploaded.json.photo.id),
    `upload=${uploaded.status}`
  );

  // ── 無効化: 写真を消したら、次に開いたとき消えていること ──
  const removed = await api(`/api/photos/${uploaded.json.photo.id}`, {
    method: "DELETE",
    cookie: adminCookie,
  });
  const afterDelete = await api(albumUrl, { cookie: adminCookie });
  check(
    "F67 写真を消したらアルバム詳細から即消える（無効化）",
    removed.status === 200 && !afterDelete.text.includes(uploaded.json.photo.id),
    `delete=${removed.status}`
  );

  // ── 無効化: アルバム名を変えたら、グループ詳細にも即反映されること ──
  const renamed = await api(`/api/albums/${album.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { title: "改名したアルバム" },
  });
  const groupAfterRename = await api(groupUrl, { cookie: adminCookie });
  check(
    "F68 アルバム改名がグループ詳細にも即反映される（無効化）",
    renamed.status === 200 && groupAfterRename.text.includes("改名したアルバム"),
    `patch=${renamed.status}`
  );
  await api(`/api/albums/${album.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { title: "エルデンリング" },
  });

  // ── 無効化: ゲームを足したら、グループ詳細に即出ること ──
  const addedGame = await api(`/api/groups/${group.id}/games`, {
    method: "POST",
    cookie: adminCookie,
    // 他のケースで使っていないapp ID（衝突すると409になる）
    body: { steamAppId: 1174180, title: "レッド・デッド・リデンプション2" },
  });
  const groupAfterGame = await api(groupUrl, { cookie: adminCookie });
  check(
    "F69 ゲーム追加がグループ詳細に即出る（無効化）",
    (addedGame.status === 200 || addedGame.status === 201) &&
      groupAfterGame.text.includes("レッド・デッド・リデンプション2"),
    `add=${addedGame.status} 出た=${groupAfterGame.text.includes("レッド・デッド")}`
  );
}

const summary = writeResults("flows", "F: 主要導線", results);
console.table(results.filter((r) => !r.ok));
await db.$disconnect();
process.exitCode = summary.failed > 0 ? 1 : 0;
