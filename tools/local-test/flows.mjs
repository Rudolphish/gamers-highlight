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
  // スタブが記録した外部呼び出しの行。件数だけでなく「どのサービスを引いたか」も見たいので
  // 行そのものを返す（F57b/F57cはYouTubeを引いたかどうかで判定する）。
  const externalCalls = () => {
    try {
      return readFileSync("/tmp/stub-calls.log", "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const externalCallCount = () => externalCalls().length;

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

  // **短縮した間隔で来たリフレッシュは、落ちていたぶんだけ引くこと。**
  // ここが全ソース取得のままだと、HowLongToBeatに該当が無いゲーム（hltbGameIdが
  // 正当に永久nullになる）で6時間ごとの全件取得が恒久化し、埋まっているYouTubeまで
  // 毎回引き直す。短い間隔にした目的（落ちていたぶんの回収）と正反対の結果になる。
  await db.externalGameCache.update({
    where: { steamAppId: APP_ID },
    data: { hltbGameId: null },
  });
  await db.$executeRaw`UPDATE external_game_caches SET "updatedAt" = NOW() - INTERVAL '7 hours' WHERE "steamAppId" = ${APP_ID}`;
  const beforePartial = externalCalls();
  await api(`/api/groups/${group.id}/games/${game570.id}/refresh`, {
    method: "POST",
    cookie: adminCookie,
  });
  const spentPartial = externalCalls().slice(beforePartial.length);
  check(
    "F57b 短縮間隔のリフレッシュは埋まっているYouTubeを引き直さない",
    spentPartial.every((line) => !line.includes("googleapis.com")),
    `外部呼び出し: ${spentPartial.join(" | ").slice(0, 200) || "なし"}`
  );

  // 24時間も過ぎているなら、それは普通のリフレッシュ。全部引き直してよい
  await db.$executeRaw`UPDATE external_game_caches SET "updatedAt" = NOW() - INTERVAL '25 hours' WHERE "steamAppId" = ${APP_ID}`;
  const beforeFull = externalCalls();
  await api(`/api/groups/${group.id}/games/${game570.id}/refresh`, {
    method: "POST",
    cookie: adminCookie,
  });
  const spentFull = externalCalls().slice(beforeFull.length);
  check(
    "F57c 24時間経っていれば全ソースを引き直す",
    spentFull.some((line) => line.includes("googleapis.com")),
    `外部呼び出し: ${spentFull.join(" | ").slice(0, 200) || "なし"}`
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
  // 直前に開いてキャッシュを温めてから変更する（温めないと偶然通る）
  await api(albumUrl, { cookie: adminCookie });
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
  await api(albumUrl, { cookie: adminCookie });
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
  //
  // **直前にグループ詳細を開いてキャッシュを温めてから変更する。**
  // これを挟まないと、前のケースが飛ばしたタグのおかげで偶然通ってしまい、
  // PATCHが無効化を呼んでいなくてもOKになる（実際にそうなっていて、
  // 自動レビューに「PATCHに無効化が無い」と指摘されるまで気づけなかった）。
  await api(groupUrl, { cookie: adminCookie });

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
  await api(groupUrl, { cookie: adminCookie });
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

// ───────────────────────────────────────────────────────────
// K. Botのゲーム候補（プレイ中だけを返す）
// ───────────────────────────────────────────────────────────
{
  const internal = { "x-internal-secret": INTERNAL_SECRET };
  const res = await api(`/api/internal/group-games?guildId=${group.guildId}`, { headers: internal });
  const titles = (res.json?.games ?? []).map((g) => g.title);

  check("F70 候補APIが応答する", res.status === 200, `${res.status} ${res.text.slice(0, 80)}`);
  check(
    "F71 プレイ中のゲームが候補に出る",
    titles.includes("ウィッチャー3"),
    JSON.stringify(titles)
  );
  check(
    "F72 プレイ中以外（気になる・積みゲー・クリア済み）は出ない",
    !titles.some((t) => ["ELDEN RING", "DOOM（積みゲー）", "Half-Life 2（クリア済み）"].includes(t)),
    JSON.stringify(titles)
  );

  // 上限（Discordのセレクトメニューは25個まで。「その他」で1つ使うので24件）
  const extra = [];
  for (let i = 0; i < 30; i++) {
    extra.push(
      db.groupGame.create({
        data: {
          groupId: group.id,
          steamAppId: 900000 + i,
          title: `上限確認用ゲーム${i}`,
          status: "PLAYING",
          addedById: (await db.user.findUnique({ where: { email: "admin@example.com" } })).id,
        },
      })
    );
  }
  await Promise.all(extra);

  const many = await api(`/api/internal/group-games?guildId=${group.guildId}`, { headers: internal });
  const count = (many.json?.games ?? []).length;
  check("F73 候補は24件で頭打ちになる（Discordの25個制限）", count === 24, `${count}件`);

  await db.groupGame.deleteMany({ where: { steamAppId: { gte: 900000, lt: 900030 } } });
}

// ───────────────────────────────────────────────────────────
// L. 提案したゲームでもクリア時間・関連動画が出ること
//    （提案ページは ExternalGameCache にある場合だけ出す作りなので、
//     作成時に埋めていないと採用されるまで空のままになる）
// ───────────────────────────────────────────────────────────
{
  const APP_ID = 1174180; // まだ誰も追加・提案していないapp ID
  await db.groupGameProposal.deleteMany({ where: { steamAppId: APP_ID } });
  await db.groupGame.deleteMany({ where: { steamAppId: APP_ID } });
  await db.externalGameCache.deleteMany({ where: { steamAppId: APP_ID } });

  const proposed = await api(`/api/groups/${group.id}/proposals`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: APP_ID, title: "レッド・デッド・リデンプション2" },
  });
  check("F74 ゲームを提案できる", proposed.status === 201, `${proposed.status} ${proposed.text.slice(0, 80)}`);

  const cache = await db.externalGameCache.findUnique({ where: { steamAppId: APP_ID } });
  check(
    "F75 提案の作成でクリア時間と関連動画がキャッシュに入る",
    cache?.hltbGameId != null && cache?.youtubeVideoId != null,
    `HLTB=${cache?.hltbGameId} YT=${cache?.youtubeVideoId}`
  );
  check(
    "F76 提案のカバーがappdetails由来（組み立てURLでない）",
    !!cache?.headerImage && cache.headerImage.includes("store_item_assets"),
    cache?.headerImage
  );

  // 実際に提案ページへ出ること
  const proposalId = proposed.json?.proposal?.id;
  const page = await api(`/groups/${group.id}/proposals/${proposalId}`, { cookie: adminCookie });
  check(
    "F77 提案ページにクリア時間と関連動画が出る",
    page.status === 200 && page.text.includes("stubVideoId") && page.text.includes("クリア"),
    `${page.status} 動画=${page.text.includes("stubVideoId")} 時間=${page.text.includes("クリア")}`
  );

  await db.groupGameProposal.deleteMany({ where: { steamAppId: APP_ID } });
}

// ───────────────────────────────────────────────────────────
// K. 写真へのリアクション（❤️）
// ───────────────────────────────────────────────────────────
{
  const { readFileSync } = await import("node:fs");
  const album = await db.album.findFirst({ where: { title: "エルデンリング" } });
  const photo = await db.photo.findFirst({ where: { albumId: album.id } });
  const admin = await db.user.findUnique({ where: { email: "admin@example.com" } });
  await db.photoReaction.deleteMany({ where: { photoId: photo.id } });

  const react = () =>
    api(`/api/photos/${photo.id}/reactions`, { method: "POST", cookie: adminCookie });

  const on = await react();
  check(
    "F78 写真に❤️を付けられる",
    on.status === 200 && on.json?.count === 1 && on.json?.reacted === true,
    `${on.status} ${on.text.slice(0, 80)}`
  );

  const off = await react();
  check(
    "F79 もう一度押すと取り消される（トグル）",
    off.status === 200 && off.json?.count === 0 && off.json?.reacted === false,
    `${off.status} ${off.text.slice(0, 80)}`
  );

  // 別の人も押せる＝人数で数える。1人1回なので同じ人が二重に入らないことも見る
  await react();
  await api(`/api/photos/${photo.id}/reactions`, { method: "POST", cookie: memberCookie });
  const rows = await db.photoReaction.findMany({ where: { photoId: photo.id } });
  check(
    "F80 別のメンバーも押せて、1人1回に収まる",
    rows.length === 2 && new Set(rows.map((r) => r.userId)).size === 2,
    `${rows.length}件 / ユーザー${new Set(rows.map((r) => r.userId)).size}人`
  );

  // **写真のキャッシュを飛ばしていないこと。**
  // ここで飛ばすと、押すたびにアルバムの写真キャッシュが無効になり #43 の効果が消える。
  // アルバムページを2回開いて、2回目がキャッシュヒット（＝クエリが減る）ままかを見る。
  // 直接の観測は難しいので、ここでは「押した後もページが200で開けて❤️の数が出る」ことと、
  // ルートが cacheTags を import していないことの2点で担保する（後者は下のF82）。
  const page = await api(`/albums/${album.id}`, { cookie: adminCookie });
  check(
    "F81 アルバムページに❤️の数が出る",
    page.status === 200 && page.text.includes("リアクション"),
    `${page.status} ${page.text.includes("リアクション")}`
  );

  const routeSource = readFileSync(
    new URL("../../apps/web/src/app/api/photos/[id]/reactions/route.ts", import.meta.url),
    "utf8"
  );
  // **コメント中の言及に引っかからないよう、実際のimport文と呼び出しだけを見る。**
  // 最初 routeSource.includes("cacheTags") で書いたら、
  // 「なぜ呼ばないか」を説明したコメントに当たって落ちた
  const importsCacheTags = /from\s+["']@\/lib\/cacheTags["']/.test(routeSource);
  const callsRevalidate = /\brevalidateTag\s*\(/.test(routeSource);
  check(
    "F82 リアクションのAPIは写真のキャッシュを飛ばさない",
    !importsCacheTags && !callsRevalidate,
    `import=${importsCacheTags} revalidateTag=${callsRevalidate}`
  );

  // 写真を消したらリアクションも消える（onDelete: Cascade）
  const doomed = await db.photo.create({
    data: {
      mediaType: "IMAGE",
      mediaUrl: "http://127.0.0.1:9100/gh-local/photos/doomed.png",
      uploaderId: admin.id,
      albumId: album.id,
      source: "MANUAL",
    },
  });
  await api(`/api/photos/${doomed.id}/reactions`, { method: "POST", cookie: adminCookie });
  await db.photo.delete({ where: { id: doomed.id } });
  const orphans = await db.photoReaction.count({ where: { photoId: doomed.id } });
  check("F83 写真を消すとリアクションも消える", orphans === 0, `${orphans}件残った`);

  await db.photoReaction.deleteMany({ where: { photoId: photo.id } });
}

// ───────────────────────────────────────────────────────────
// L. 写真の説明
// ───────────────────────────────────────────────────────────
{
  const album = await db.album.findFirst({ where: { title: "エルデンリング" } });
  const photo = await db.photo.findFirst({ where: { albumId: album.id } });
  const admin = await db.user.findUnique({ where: { email: "admin@example.com" } });
  const memberUser = await db.user.findUnique({ where: { email: "member@example.com" } });

  const patch = (description, cookie = adminCookie) =>
    api(`/api/photos/${photo.id}`, { method: "PATCH", cookie, body: { description } });

  const written = await patch("夜のリムグレイブ。写り込んだ月がきれい");
  check(
    "F84 写真に説明を書ける",
    written.status === 200 && written.json?.description?.includes("リムグレイブ"),
    `${written.status} ${written.text.slice(0, 100)}`
  );

  const row = await db.photo.findUnique({ where: { id: photo.id } });
  check(
    "F85 書き手と日時が残る",
    row.descriptionUpdatedById === admin.id && row.descriptionUpdatedAt !== null,
    `by=${row.descriptionUpdatedById} at=${row.descriptionUpdatedAt}`
  );

  // 別のグループメンバーが上書きできる（1枚に1つ・後勝ち）
  const overwritten = await patch("実は昼だった", memberCookie);
  const row2 = await db.photo.findUnique({ where: { id: photo.id } });
  check(
    "F86 別のメンバーが上書きでき、書き手も入れ替わる",
    overwritten.status === 200 &&
      row2.description === "実は昼だった" &&
      row2.descriptionUpdatedById === memberUser.id,
    `${overwritten.status} ${row2.description} by=${row2.descriptionUpdatedById}`
  );

  // 空にすると説明が消え、書き手の記録も消える（写真は残る）
  const cleared = await patch("   ");
  const row3 = await db.photo.findUnique({ where: { id: photo.id } });
  check(
    "F87 空にすると説明も書き手の記録も消える（写真は残る）",
    cleared.status === 200 &&
      row3 !== null &&
      row3.description === null &&
      row3.descriptionUpdatedById === null &&
      row3.descriptionUpdatedAt === null,
    `${cleared.status} desc=${row3?.description} by=${row3?.descriptionUpdatedById}`
  );

  // 説明で検索できる（ゲームタイトルに含まれない語で引く）
  await patch("スクリーンショット祭りの夜");
  const found = await api("/api/photos/search?game=" + encodeURIComponent("祭り"), {
    cookie: adminCookie,
  });
  check(
    "F88 説明の文字列で写真を検索できる",
    found.status === 200 && (found.json?.photos ?? []).some((p) => p.id === photo.id),
    `${found.status} ${(found.json?.photos ?? []).length}件`
  );

  // ゲームタイトルでの検索も従来どおり効く（ORにしたことで壊していないか）
  const byGame = await api("/api/photos/search?game=" + encodeURIComponent("ELDEN"), {
    cookie: adminCookie,
  });
  check(
    "F89 ゲームタイトルでの検索は従来どおり効く",
    byGame.status === 200 && (byGame.json?.photos ?? []).length > 0,
    `${byGame.status} ${(byGame.json?.photos ?? []).length}件`
  );

  // **説明はキャッシュに載っているので、書き換えたら飛ばすこと。**
  // 飛ばし忘れると「書いたのにページに出ない」が起き、しかも時間では直らない。
  // 一度ページを開いてキャッシュを温めてから書き換え、次に開いて反映されるかを見る。
  await api(`/albums/${album.id}`, { cookie: adminCookie });
  await patch("キャッシュ確認用のせつめい");
  const page = await api(`/albums/${album.id}`, { cookie: adminCookie });
  check(
    "F90 説明を書き換えるとアルバムページに反映される（キャッシュが飛ぶ）",
    page.status === 200 && page.text.includes("キャッシュ確認用のせつめい"),
    `${page.status} 反映=${page.text.includes("キャッシュ確認用のせつめい")}`
  );

  await patch("");
}

// ───────────────────────────────────────────────────────────
// 活動ログ（週次まとめ／カレンダーの元データ）
// ───────────────────────────────────────────────────────────
{
  const photo = await db.photo.findFirst({ where: { albumId: album.id } });
  const game = await db.groupGame.findFirst({ where: { groupId: group.id } });

  /** 対象を絞って数える。**全体の件数で判定しない**——他のスイートが足したぶんで揺れるため */
  const logs = (where) => db.activityLog.findMany({ where, orderBy: { createdAt: "asc" } });

  // --- ❤️: 付けたときと外したときの両方が残ること ---
  await db.activityLog.deleteMany({ where: { targetId: photo.id } });
  await db.photoReaction.deleteMany({ where: { photoId: photo.id } });

  await api(`/api/photos/${photo.id}/reactions`, { method: "POST", cookie: adminCookie });
  const added = await logs({ targetId: photo.id, kind: "photo.reaction_added" });
  check(
    "F91 ❤️を押すと活動ログに残り、groupIdが入る",
    added.length === 1 && added[0].groupId === group.id,
    `${added.length}件 groupId=${added[0]?.groupId}`
  );

  await api(`/api/photos/${photo.id}/reactions`, { method: "POST", cookie: adminCookie });
  const removed = await logs({ targetId: photo.id, kind: "photo.reaction_removed" });
  check(
    "F92 取り消しも残る（付けた記録が消えない）",
    removed.length === 1 && added.length === 1,
    `added=${added.length} removed=${removed.length}`
  );

  // --- 説明: 書いたときと消したときで kind が分かれること ---
  await db.activityLog.deleteMany({ where: { targetId: photo.id } });
  const patchDesc = (text) =>
    api(`/api/photos/${photo.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { description: text },
    });

  await patchDesc("活動ログの確認用");
  await patchDesc("");
  const descLogs = await logs({ targetId: photo.id, kind: { startsWith: "photo.description" } });
  check(
    "F93 説明の「書いた」「消した」が別々に残る",
    descLogs.length === 2 &&
      descLogs[0].kind === "photo.description_set" &&
      descLogs[1].kind === "photo.description_cleared",
    descLogs.map((l) => l.kind).join(",")
  );

  // --- ゲームのステータス変更: from→to が入ること ---
  // **これが今回いちばん重要。** GroupGame.updatedAt では代用できない
  // （日次cronが lastPriceCheckedAt を毎日書くので毎日動く）。
  await db.activityLog.deleteMany({ where: { targetId: game.id } });
  await db.groupGame.update({ where: { id: game.id }, data: { status: "PLAYING" } });

  await api(`/api/groups/${group.id}/games/${game.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "COMPLETED" },
  });
  const statusLogs = await logs({ targetId: game.id, kind: "game.status_changed" });
  check(
    "F94 ステータス変更が from→to つきで残る（今週クリアしたゲームが出せる）",
    statusLogs.length === 1 &&
      statusLogs[0].detail?.from === "PLAYING" &&
      statusLogs[0].detail?.to === "COMPLETED" &&
      statusLogs[0].targetName === game.title,
    JSON.stringify(statusLogs[0]?.detail ?? null)
  );

  // 同じステータスで保存し直しても増えないこと（増えると「今週クリアした」が空振りする）
  await api(`/api/groups/${group.id}/games/${game.id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { status: "COMPLETED" },
  });
  const afterNoop = await logs({ targetId: game.id, kind: "game.status_changed" });
  check(
    "F95 同じステータスで保存し直しても記録が増えない",
    afterNoop.length === 1,
    `${afterNoop.length}件`
  );

  // --- occurredAt: 撮影日時が入ること ---
  // 去年撮ったスクショを今日上げても、カレンダー上は撮った日に並んでほしい
  const captured = new Date("2025-03-04T05:06:07.000Z");
  const created = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: {
      contentType: "image/png",
      mediaUrl: "http://127.0.0.1:9100/gh-local/activity-occurred.png",
      albumId: album.id,
      capturedAt: captured.toISOString(),
      sizeBytes: 1234,
    },
  });
  const createdId = created.json?.photo?.id;
  // **targetId が undefined のまま findMany に渡さないこと。**
  // Prisma は undefined を「その条件は指定なし」として扱うので、絞ったつもりが
  // 全件から拾ってしまう。最初これで、投稿が400になっていたのに別の写真のログを
  // 見て「occurredAt が違う」と誤診した。
  const createdLog = createdId
    ? (await logs({ targetId: createdId, kind: "photo.created" }))[0]
    : null;
  check(
    "F96 写真の occurredAt は撮影日時（記録時刻ではない）",
    created.status === 201 &&
      !!createdLog &&
      createdLog.occurredAt.getTime() === captured.getTime() &&
      createdLog.createdAt.getTime() !== captured.getTime(),
    `status=${created.status} occurredAt=${createdLog?.occurredAt?.toISOString()} createdAt=${createdLog?.createdAt?.toISOString()}`
  );

  // --- 未分類→振り分けで groupId が埋まること ---
  // Discord経由の未分類はアルバムに属さないので、投稿時点では groupId が決まらない。
  // 埋め直しを忘れると、その投稿がグループの週次まとめに一生出てこない。
  const loose = await db.photo.create({
    data: {
      mediaType: "IMAGE",
      mediaUrl: "http://127.0.0.1:9100/gh-local/activity-loose.jpg",
      uploaderId: (await db.user.findFirst({ where: { email: "admin@example.com" } })).id,
      source: "DISCORD",
    },
  });
  await db.activityLog.create({
    data: {
      kind: "photo.created",
      targetId: loose.id,
      groupId: null,
      actorId: loose.uploaderId,
      occurredAt: loose.createdAt,
    },
  });
  await api("/api/photos/assign-album", {
    method: "POST",
    cookie: adminCookie,
    body: { photoIds: [loose.id], albumId: album.id },
  });
  const filled = await logs({ targetId: loose.id, kind: "photo.created" });
  check(
    "F97 未分類をアルバムへ振り分けると groupId が埋まる（行は増えない）",
    filled.length === 1 && filled[0].groupId === group.id,
    `${filled.length}件 groupId=${filled[0]?.groupId}`
  );

  // --- メンバー追加を繰り返しても「加入」は1回だけ ---
  // **このエンドポイントで作られたメンバーは acceptedAt が入らない**（入るのは招待リンク経由だけ）。
  // 最初「acceptedAt が null なら新規」で判定していたため、役割変更で呼び直すたびに
  // member.joined が増え、「同じ人が何度も加入した」記録になっていた（後追いレビューで発覚）。
  const outsiderUser = await db.user.findFirst({ where: { email: "outsider@example.com" } });
  await db.groupMember.deleteMany({ where: { groupId: group.id, userId: outsiderUser.id } });
  await db.activityLog.deleteMany({ where: { targetId: outsiderUser.id, kind: "member.joined" } });

  const addMember = (role) =>
    api(`/api/groups/${group.id}/members`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: "outsider@example.com", role },
    });
  await addMember("VIEWER");
  await addMember("EDITOR"); // 役割変更のつもりで同じ人を再度追加する
  const joins = await logs({ targetId: outsiderUser.id, kind: "member.joined" });
  check(
    "F99 同じ人を追加し直しても「加入」は1回しか記録されない",
    joins.length === 1,
    `${joins.length}件`
  );
  await db.groupMember.deleteMany({ where: { groupId: group.id, userId: outsiderUser.id } });
  await db.activityLog.deleteMany({ where: { targetId: outsiderUser.id, kind: "member.joined" } });

  // --- GETでは増えないこと ---
  const beforeGet = await db.activityLog.count();
  await api(`/albums/${album.id}`, { cookie: adminCookie });
  await api(`/api/albums/${album.id}/photos`, { cookie: adminCookie });
  const afterGet = await db.activityLog.count();
  check("F98 読むだけでは活動ログが増えない", beforeGet === afterGet, `${beforeGet} → ${afterGet}`);

  // 後片付け。**自分が変えたものは戻す**（seedのデータを次のスイートへ渡すため）
  await db.groupGame.update({ where: { id: game.id }, data: { status: game.status } });

  // **写真の削除は必ずAPI経由で行う。** db.photo.delete で直に消すと
  // invalidateAlbumPhotos を通らないので、アルバムのキャッシュに消えた写真が残る。
  // 次に走るブラウザスイート（B）がその写真をクリックし、❤️も説明も 404 になって落ちた
  // （CIでB34・B36・B39・B41が落ちた実際の原因がこれ。アプリの不具合ではなく後片付けの穴）。
  for (const id of [createdId, loose.id].filter(Boolean)) {
    await api(`/api/photos/${id}`, { method: "DELETE", cookie: adminCookie });
  }
  await db.activityLog.deleteMany({
    where: { targetId: { in: [photo.id, game.id, createdId, loose.id].filter(Boolean) } },
  });
  await db.photoReaction.deleteMany({ where: { photoId: photo.id } });
}

// ───────────────────────────────────────────────────────────
// 週次まとめ（管理画面のプレビュー）
// ───────────────────────────────────────────────────────────
{
  // **週の境界をテスト側で独立に計算する。** 実装と同じ式をコピーすると、
  // 式が間違っていても両方同じように間違うので何も確認できない。
  // ここでは Intl（Asia/Tokyo）から JST の壁時計を出して月曜0時を求める。
  const jstMondayStart = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t).value;
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const daysFromMonday = names.indexOf(get("weekday"));
    // JSTの月曜0時 = その日のUTC 15:00（前日）
    const midnightJstAsUtc = Date.parse(`${get("year")}-${get("month")}-${get("day")}T00:00:00+09:00`);
    return new Date(midnightJstAsUtc - daysFromMonday * 24 * 60 * 60 * 1000);
  };

  const monday = jstMondayStart();
  const weeklyPage = async (week) => {
    const res = await api(`/admin/weekly?group=${group.id}&week=${week}`, { cookie: adminCookie });
    const m = res.text.match(/📷 投稿 (\d+)/);
    return { status: res.status, posts: m ? Number(m[1]) : null, text: res.text };
  };

  const before = await weeklyPage(0);
  check(
    "F100 週次まとめのページが管理者に出る",
    before.status === 200 && before.posts !== null,
    `${before.status} 投稿=${before.posts}`
  );

  const addLog = (createdAt) =>
    db.activityLog.create({
      data: {
        kind: "photo.created",
        targetId: `boundary-${createdAt.getTime()}`,
        groupId: group.id,
        actorId: null,
        occurredAt: createdAt,
        createdAt,
      },
    });

  // 月曜0時ちょうど＝今週に入る
  await addLog(monday);
  const afterInside = await weeklyPage(0);
  check(
    "F101 月曜0時（JST）ちょうどの記録は今週に数えられる",
    afterInside.posts === before.posts + 1,
    `${before.posts} → ${afterInside.posts}`
  );

  // その1ミリ秒前＝先週に入る（今週は増えない）
  const lastWeekBefore = await weeklyPage(-1);
  await addLog(new Date(monday.getTime() - 1));
  const [afterOutside, lastWeekAfter] = [await weeklyPage(0), await weeklyPage(-1)];
  check(
    "F102 その1ミリ秒前は先週に入る（今週は増えない）",
    afterOutside.posts === afterInside.posts && lastWeekAfter.posts === lastWeekBefore.posts + 1,
    `今週 ${afterInside.posts} → ${afterOutside.posts} / 先週 ${lastWeekBefore.posts} → ${lastWeekAfter.posts}`
  );

  // **クリアしたゲームが出ること。** ActivityLog にしか無い情報で、
  // これを出せるようにするのが週次まとめの主目的のひとつ
  await db.activityLog.create({
    data: {
      kind: "game.status_changed",
      targetId: "boundary-completed",
      targetName: "テスト用クリアゲーム",
      groupId: group.id,
      occurredAt: new Date(),
      detail: { from: "PLAYING", to: "COMPLETED" },
    },
  });
  const withCompleted = await weeklyPage(0);
  check(
    "F103 今週クリアしたゲームが文面に出る",
    withCompleted.text.includes("テスト用クリアゲーム"),
    "出ていない"
  );

  // ステータス変更でも COMPLETED 以外は「クリア」に混ざらないこと
  await db.activityLog.create({
    data: {
      kind: "game.status_changed",
      targetId: "boundary-playing",
      targetName: "クリアではないゲーム",
      groupId: group.id,
      occurredAt: new Date(),
      detail: { from: "WISHLIST", to: "PLAYING" },
    },
  });
  const withPlaying = await weeklyPage(0);
  check(
    "F104 クリア以外のステータス変更は「クリア」に出ない",
    !withPlaying.text.includes("クリアではないゲーム"),
    "混ざっている"
  );

  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "boundary-" } } });
}

// ───────────────────────────────────────────────────────────
// 日次ロールアップと生ログの掃除（cronに相乗り）
// ───────────────────────────────────────────────────────────
{
  const runCron = () =>
    api("/api/cron/check-bot-health", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  const jstDay = (d) => {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(
      jst.getUTCDate()
    ).padStart(2, "0")}`;
  };
  // @db.Date はUTCで切り捨てられるので、読み出した値もUTCの0時で返る
  const dayColumn = (dateString) => new Date(`${dateString}T00:00:00.000Z`);

  await db.dailyActivity.deleteMany({ where: { groupId: group.id } });
  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "rollup-" } } });

  // **occurredAt の日で集計されること。** カレンダーは「実際に起きた日」で並べるので、
  // 記録した日（createdAt）で数えてはいけない。
  // 去年撮ったスクショを今日上げた、という形を作って確かめる。
  const lastYear = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
  await db.activityLog.create({
    data: {
      kind: "photo.created",
      targetId: "rollup-old-occurred",
      groupId: group.id,
      occurredAt: lastYear, // 起きたのは200日前
      createdAt: new Date(), // 記録したのは今
    },
  });

  const first = await runCron();
  check("F105 cronが完走する（ロールアップ込み）", first.status === 200, first.text);

  const oldDay = await db.dailyActivity.findMany({
    where: { groupId: group.id, date: dayColumn(jstDay(lastYear)) },
  });
  check(
    "F106 ロールアップは occurredAt の日に積む（記録した日ではない）",
    oldDay.length === 1 && oldDay[0].kind === "photo.created" && oldDay[0].count === 1,
    `${oldDay.length}行 ${JSON.stringify(oldDay[0] ?? null)}`
  );

  // **二重に走っても倍にならないこと。** 足し込みだと cron が二度走った日だけ件数が倍になり、
  // しかも画面からは気づけない
  await runCron();
  const afterTwice = await db.dailyActivity.findMany({
    where: { groupId: group.id, date: dayColumn(jstDay(lastYear)) },
  });
  check(
    "F107 cronを2回流しても件数が倍にならない（置き換え）",
    afterTwice.length === 1 && afterTwice[0].count === 1,
    `count=${afterTwice[0]?.count}`
  );

  // **保持期間（1年）を過ぎた生ログが消え、集計は残ること。**
  const tooOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  await db.activityLog.create({
    data: {
      kind: "photo.created",
      targetId: "rollup-expired",
      groupId: group.id,
      occurredAt: tooOld,
      createdAt: tooOld, // 記録も400日前 = 保持期間を過ぎている
    },
  });
  // 消える前の日を先に集計しておく（本番では毎日のcronが順に集計している状態にあたる）
  await db.dailyActivity.create({
    data: { groupId: group.id, date: dayColumn(jstDay(tooOld)), kind: "photo.created", count: 1 },
  });

  await runCron();
  const expiredLog = await db.activityLog.findFirst({ where: { targetId: "rollup-expired" } });
  const expiredDay = await db.dailyActivity.findMany({
    where: { groupId: group.id, date: dayColumn(jstDay(tooOld)) },
  });
  check(
    "F108 1年より古い生ログは消え、その日の件数は残る",
    expiredLog === null && expiredDay.length === 1 && expiredDay[0].count === 1,
    `生ログ=${expiredLog ? "残っている" : "消えた"} / 集計=${expiredDay.length}行`
  );

  // 保持期間内の記録は消えないこと（消しすぎの検出）
  const survivor = await db.activityLog.findFirst({ where: { targetId: "rollup-old-occurred" } });
  check("F109 保持期間内の生ログは消えない", survivor !== null, "消えてしまった");

  // **消えたグループの集計が残り続けないこと。**
  // DailyActivity は永久に残す方針なので、放っておくと孤児が永久に溜まる
  // （生ログの方は1年で消えるが、こちらには期限が無い）。
  await db.dailyActivity.create({
    data: {
      groupId: "存在しないグループ",
      date: dayColumn(jstDay(new Date())),
      kind: "photo.created",
      count: 3,
    },
  });
  await runCron();
  const orphan = await db.dailyActivity.findFirst({ where: { groupId: "存在しないグループ" } });
  check("F110 消えたグループの集計は片付けられる", orphan === null, "残っている");

  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "rollup-" } } });
  await db.dailyActivity.deleteMany({ where: { groupId: group.id } });
}

// ───────────────────────────────────────────────────────────
// 週次まとめのDiscord通知（未送信の完了週があれば送る）
// ───────────────────────────────────────────────────────────
{
  const fs = await import("node:fs");
  const DISCORD_LOG = "/tmp/stub-discord.log";
  const runCron = () =>
    api("/api/cron/check-bot-health", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const discordSince = (mark) => {
    const lines = fs.existsSync(DISCORD_LOG)
      ? fs.readFileSync(DISCORD_LOG, "utf8").split("\n").filter(Boolean)
      : [];
    return lines.slice(mark);
  };
  const discordCount = () =>
    fs.existsSync(DISCORD_LOG)
      ? fs.readFileSync(DISCORD_LOG, "utf8").split("\n").filter(Boolean).length
      : 0;
  const setting = (key) => db.appSetting.findUnique({ where: { key } });

  // 完了した週（先週）の中に確実に動きを作る。
  // **週の境界はテスト側で独立に計算する**（実装と同じ式をコピーすると、
  // 式が間違っていても両方同じように間違って何も確認できない）。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const daysFromMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const thisMonday = new Date(
    Date.parse(`${get("year")}-${get("month")}-${get("day")}T00:00:00+09:00`) -
      daysFromMonday * 24 * 60 * 60 * 1000
  );
  const lastWeekMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const insideLastWeek = new Date(lastWeekMonday.getTime() + 24 * 60 * 60 * 1000);
  // 記録に入るキー（JSTの月曜日）。実装と同じ式をコピーせず、Intlから独立に出す
  const expectedWeekKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(lastWeekMonday);

  // **記録を空にしてから始める。** このログはプロセスを跨いで残るので、
  // 前の実行（途中で落ちた回も含む）の投稿が混ざると、件数の判定がずれる。
  // 実際にこれで「送っているのに0件」と誤検知した。
  fs.rmSync(DISCORD_LOG, { force: true });

  await db.appSetting.deleteMany({
    where: { key: { in: ["weeklySummaryChannelId", "weeklySummaryLastSentWeek"] } },
  });
  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "weekly-" } } });
  await db.activityLog.create({
    data: {
      kind: "photo.created",
      targetId: "weekly-lastweek",
      groupId: group.id,
      actorId: null,
      occurredAt: insideLastWeek,
      createdAt: insideLastWeek, // 週次まとめは createdAt で数える
    },
  });

  // **通知先が未設定なら送らない。しかも「送信済み」にもしない。**
  // 記録を進めてしまうと、後からチャンネルを設定してもその週は飛ばされる
  let mark = discordCount();
  await runCron();
  const unsetRecord = await setting("weeklySummaryLastSentWeek");
  check(
    "F111 通知先が未設定なら送らず、送信済みにもしない",
    discordSince(mark).length === 0 && unsetRecord === null,
    `投稿=${discordSince(mark).length}件 / 記録=${unsetRecord?.value ?? "なし"}`
  );

  // 通知先を保存（管理者のみ）
  const save = await api("/api/admin/weekly-notify", {
    method: "PUT",
    cookie: adminCookie,
    body: { channelId: "123456789012345678" },
  });
  check("F112 週次まとめの通知先を保存できる", save.status === 200, save.text);

  const memberSave = await api("/api/admin/weekly-notify", {
    method: "PUT",
    cookie: memberCookie,
    body: { channelId: "123456789012345678" },
  });
  check("F113 通知先の保存は管理者以外は403", memberSave.status === 403, memberSave.status);

  // **未送信の完了週があるので送られる。**
  // **cronの送信はスタブの記録では確認できない。**
  // 本番ビルドでは、cronのルートから出る外部fetchが fetch-stub を通らず実ネットワークへ出る
  // （手動送信のルートは通る。同じプロセス・同じ関数なのにルートごとに違う。実測で確認）。
  // CIにネットワーク依存を持ち込まないよう、cron側は**DBに残る記録**で判定し、
  // 文面の中身はスタブを通る手動送信の方で見る。
  const cronRes = await runCron();
  const weekly = JSON.parse(cronRes.text).weekly;
  check(
    "F114 未送信の完了週があれば、曜日に関係なくその週を対象にする",
    weekly?.week === expectedWeekKey,
    `返り値=${JSON.stringify(weekly)} / 期待=${expectedWeekKey}`
  );

  // **二度は送らない。** cronは毎日走るので、ここが効かないと毎日届く。
  // 記録を直接入れてから確認する（cronの投稿が成功したかに左右されないように）。
  await db.appSetting.upsert({
    where: { key: "weeklySummaryLastSentWeek" },
    create: { key: "weeklySummaryLastSentWeek", value: expectedWeekKey },
    update: { value: expectedWeekKey },
  });
  const second = await runCron();
  const secondWeekly = JSON.parse(second.text).weekly;
  check(
    "F115 送信済みの週は二度送らない（毎日のcronで毎日届かない）",
    secondWeekly?.week === null && secondWeekly?.reason === "この週は送信済み",
    JSON.stringify(secondWeekly)
  );

  // **手動送信は記録を進めない**（確認のための送信であって、自動送信を済ませたことにはしない）
  const before = await setting("weeklySummaryLastSentWeek");
  mark = discordCount();
  const manual = await api("/api/admin/weekly-notify", {
    method: "POST",
    cookie: adminCookie,
    body: { week: -1 },
  });
  const after = await setting("weeklySummaryLastSentWeek");
  const sent = discordSince(mark);
  check(
    "F116 手動送信は届くが、送信済みの記録は動かさない",
    manual.status === 200 && sent.length >= 1 && after?.value === before?.value,
    `${manual.status} / 投稿=${sent.length}件 / 記録 ${before?.value} → ${after?.value}`
  );
  // **中身まで見る。** 送ったことだけ確認しても、空文字を送っていたら気づけない
  check(
    "F117 送った文面が管理画面のプレビューと同じ形になっている",
    sent.some((line) => {
      const body = JSON.parse(JSON.parse(line).body ?? "{}");
      return typeof body.content === "string" && body.content.includes("のまとめ");
    }),
    sent[0] ?? "投稿なし"
  );

  const manualByMember = await api("/api/admin/weekly-notify", {
    method: "POST",
    cookie: memberCookie,
    body: { week: -1 },
  });
  check("F118 手動送信は管理者以外は403", manualByMember.status === 403, manualByMember.status);

  // **投稿の失敗を「送った」と数えないこと。**
  // ここを数え間違えると、cron側が「送信済み」として記録を進めてしまい、
  // その週の通知が永久に失われる（後追いレビューで見つかった不具合）。
  fs.writeFileSync("/tmp/stub-fail", "discord.com");
  const failedSend = await api("/api/admin/weekly-notify", {
    method: "POST",
    cookie: adminCookie,
    body: { week: -1 },
  });
  fs.rmSync("/tmp/stub-fail", { force: true });
  const failedBody = JSON.parse(failedSend.text);
  check(
    "F119 投稿に失敗したら「送った」に数えず、失敗として返す",
    failedBody.posted === 0 && failedBody.failed >= 1,
    failedSend.text
  );

  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "weekly-" } } });
  await db.appSetting.deleteMany({
    where: { key: { in: ["weeklySummaryChannelId", "weeklySummaryLastSentWeek"] } },
  });
}

// ───────────────────────────────────────────────────────────
// 活動カレンダーとタイムライン（/admin/activity）
// ───────────────────────────────────────────────────────────
{
  const DAY = 24 * 60 * 60 * 1000;
  const jstDay = (d) => {
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(
      jst.getUTCDate()
    ).padStart(2, "0")}`;
  };
  const dayColumn = (dateString) => new Date(`${dateString}T00:00:00.000Z`);

  /** その日を選んだ状態で開く。内訳のチップ（絵文字＋件数）を読む */
  const dayPage = async (dateString, cookie = adminCookie) => {
    const month = dateString.slice(0, 7);
    const res = await api(
      `/admin/activity?group=${group.id}&month=${month}&date=${dateString}`,
      { cookie }
    );
    // チップは「📷 3」の形。タイムラインの行は絵文字とラベルの間にタグが挟まるので当たらない
    const m = res.text.match(/📷 (\d+)/);
    return { status: res.status, photos: m ? Number(m[1]) : 0, text: res.text };
  };

  const addLog = (targetId, occurredAt, extra = {}) =>
    db.activityLog.create({
      data: {
        kind: "photo.created",
        targetId,
        groupId: group.id,
        occurredAt,
        ...extra,
      },
    });

  const today = jstDay(new Date());
  const first = await dayPage(today);
  check(
    "F120 活動カレンダーが管理者に出る",
    first.status === 200 && first.text.includes("活動カレンダー"),
    `${first.status}`
  );

  const byMember = await dayPage(today, memberCookie);
  check(
    "F121 管理者以外には活動カレンダーの中身が出ない",
    !byMember.text.includes("この月の記録"),
    "中身が出ている"
  );

  // **occurredAt の日に置かれること。** 記録した日（createdAt）で置くと、
  // 去年撮ったスクショを今日上げたときにカレンダーが嘘になる
  const past = new Date(Date.now() - 111 * DAY);
  const pastDay = jstDay(past);
  const pastBefore = await dayPage(pastDay);
  await addLog("cal-occurred", past, { createdAt: new Date() }); // 起きたのは111日前、記録は今
  const pastAfter = await dayPage(pastDay);
  check(
    "F122 カレンダーは occurredAt の日に置く（記録した日ではない）",
    pastAfter.photos === pastBefore.photos + 1,
    `${pastBefore.photos} → ${pastAfter.photos}`
  );

  // **日の境界はJST。** UTCで切ると夜9時以降の投稿が翌日に落ちる
  const dayStart = new Date(`${pastDay}T00:00:00.000+09:00`);
  const prevDay = jstDay(new Date(dayStart.getTime() - 1));
  const prevBefore = await dayPage(prevDay);
  await addLog("cal-midnight", dayStart);
  const midnight = await dayPage(pastDay);
  check(
    "F123 JSTの0時ちょうどはその日に入る",
    midnight.photos === pastAfter.photos + 1,
    `${pastAfter.photos} → ${midnight.photos}`
  );

  await addLog("cal-before-midnight", new Date(dayStart.getTime() - 1));
  const [sameDay, prevAfter] = [await dayPage(pastDay), await dayPage(prevDay)];
  check(
    "F124 その1ミリ秒前は前日に入る（当日は増えない）",
    sameDay.photos === midnight.photos && prevAfter.photos === prevBefore.photos + 1,
    `当日 ${midnight.photos} → ${sameDay.photos} / 前日 ${prevBefore.photos} → ${prevAfter.photos}`
  );

  // **今日ぶんが、日次cronを待たずに出ること。**
  // ロールアップだけを見ていると、まだ集計されていない今日は必ず0に見える
  // （「さっき投稿したのに出ない」が、機能が壊れているのと区別できなくなる）
  await db.dailyActivity.deleteMany({ where: { groupId: group.id, date: dayColumn(today) } });
  const todayBefore = await dayPage(today);
  await addLog("cal-today", new Date());
  const todayAfter = await dayPage(today);
  const todayRollup = await db.dailyActivity.findMany({
    where: { groupId: group.id, date: dayColumn(today) },
  });
  check(
    "F125 今日ぶんはロールアップを待たずに出る（生ログから数える）",
    todayAfter.photos === todayBefore.photos + 1 && todayRollup.length === 0,
    `${todayBefore.photos} → ${todayAfter.photos} / 集計=${todayRollup.length}行`
  );

  // **生ログが消えた古い日でも件数は残ること。** ロールアップを永久保存している理由がこれ
  const ancient = new Date(Date.now() - 400 * DAY);
  const ancientDay = jstDay(ancient);
  await db.dailyActivity.deleteMany({ where: { groupId: group.id, date: dayColumn(ancientDay) } });
  await db.dailyActivity.create({
    data: { groupId: group.id, date: dayColumn(ancientDay), kind: "photo.created", count: 7 },
  });
  const ancientPage = await dayPage(ancientDay);
  check(
    "F126 1年より古い日はロールアップから件数だけ出す",
    ancientPage.photos === 7 && ancientPage.text.includes("1件ずつの記録は残っていません"),
    `件数=${ancientPage.photos}`
  );

  // **消えた対象へのリンクを出さないこと。** ログには外部キーを張っていないので、
  // 消えた写真やアルバムのIDが普通に残っている
  await db.activityLog.create({
    data: {
      kind: "album.created",
      targetId: "cal-missing-album",
      targetName: "消えたアルバムの名前",
      groupId: group.id,
      occurredAt: new Date(),
    },
  });
  const withMissing = await dayPage(today);
  check(
    "F127 消えた対象は名前だけ出し、リンクにはしない",
    withMissing.text.includes("消えたアルバムの名前") &&
      !withMissing.text.includes("/albums/cal-missing-album"),
    "リンクが出ている"
  );

  // 他のグループの記録が混ざらないこと
  await db.activityLog.create({
    data: {
      kind: "photo.created",
      targetId: "cal-other-group",
      groupId: "存在しないグループ",
      occurredAt: new Date(),
    },
  });
  const afterOther = await dayPage(today);
  check(
    "F128 他のグループの記録は混ざらない",
    afterOther.photos === withMissing.photos,
    `${withMissing.photos} → ${afterOther.photos}`
  );

  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "cal-" } } });
  await db.dailyActivity.deleteMany({ where: { groupId: group.id, date: dayColumn(ancientDay) } });
}

// ───────────────────────────────────────────────────────────
// アルバムの更新順（投稿したアルバムが上に来るか）
// ───────────────────────────────────────────────────────────
{
  // **seedの3件（エルデンリング/ゼルダ/あつまれ）には投稿しない。**
  // ブラウザスイート（B27）がその相対順序を見ているので、専用のアルバムを作って試す。
  const createdAlbum = await api("/api/albums", {
    method: "POST",
    cookie: adminCookie,
    body: { title: "更新順テスト用アルバム", groupId: group.id },
  });
  const touchAlbumId = createdAlbum.json?.album?.id ?? null;

  const updatedAtOf = async (id) =>
    (await db.album.findUnique({ where: { id }, select: { updatedAt: true } }))?.updatedAt ?? null;

  const uploadTo = async (albumId) => {
    const bytes = Buffer.from(`album-touch-${randomUUID()}`);
    const signed = await api("/api/photos/upload-url", {
      method: "POST",
      cookie: adminCookie,
      body: { contentType: "image/png", mediaType: "IMAGE", sizeBytes: bytes.length },
    });
    await fetch(signed.json.upload.url, {
      method: "PUT",
      headers: { "content-type": "image/png", "content-length": String(bytes.length) },
      body: bytes,
    });
    return api("/api/photos", {
      method: "POST",
      cookie: adminCookie,
      body: {
        contentType: "image/png",
        mediaUrl: signed.json.publicUrl,
        sizeBytes: bytes.length,
        albumId,
      },
    });
  };

  // **手動アップロードで進むこと。** ここが本題（「投稿したのに更新順で上に来ない」）
  const beforeUpload = await updatedAtOf(touchAlbumId);
  const uploaded = await uploadTo(touchAlbumId);
  const afterUpload = await updatedAtOf(touchAlbumId);
  check(
    "F129 手動アップロードでアルバムの updatedAt が進む",
    uploaded.status === 201 && afterUpload > beforeUpload,
    `${beforeUpload?.toISOString()} → ${afterUpload?.toISOString()}`
  );

  // **Discord取り込みでも進むこと。** 経路によって挙動が割れていたのが元の不具合
  const tag = await db.discordGameTag.findFirst({
    where: { guildId: group.guildId, tag: "eldenring" },
  });
  const autoAlbumId = tag?.autoAlbumId ?? null;
  const beforeIngest = autoAlbumId ? await updatedAtOf(autoAlbumId) : null;
  const ingested = await api("/api/discord/ingest", {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: {
      discordUserId: "100000000000000002",
      channelId: "700000000000000001",
      guildId: group.guildId,
      attachmentUrl: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
      contentType: "image/png",
      sizeBytes: 1024,
      discordMessageId: `touch-${randomUUID()}`,
      postedAt: new Date().toISOString(),
      rawTag: "eldenring",
    },
  });
  const afterIngest = autoAlbumId ? await updatedAtOf(autoAlbumId) : null;
  check(
    "F130 Discord取り込みでもアルバムの updatedAt が進む",
    ingested.status < 300 && afterIngest > beforeIngest,
    `${beforeIngest?.toISOString()} → ${afterIngest?.toISOString()}`
  );

  // **写真を消しても進まないこと。** 「消したら一番上に来た」は直感に反する
  const photoId = uploaded.json?.photo?.id ?? null;
  const beforeDelete = await updatedAtOf(touchAlbumId);
  const deleted = await api(`/api/photos/${photoId}`, { method: "DELETE", cookie: adminCookie });
  const afterDelete = await updatedAtOf(touchAlbumId);
  check(
    "F131 写真を削除しても updatedAt は進まない",
    deleted.status === 200 && afterDelete?.getTime() === beforeDelete?.getTime(),
    `${beforeDelete?.toISOString()} → ${afterDelete?.toISOString()}`
  );

  // **説明でも進まないこと**（アルバムの中身の増減ではないため）
  const forDescription = await uploadTo(touchAlbumId);
  const descPhotoId = forDescription.json?.photo?.id ?? null;
  const beforeDesc = await updatedAtOf(touchAlbumId);
  const described = await api(`/api/photos/${descPhotoId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { description: "更新順テスト" },
  });
  const afterDesc = await updatedAtOf(touchAlbumId);
  check(
    "F132 説明を書いても updatedAt は進まない",
    described.status === 200 && afterDesc?.getTime() === beforeDesc?.getTime(),
    `${beforeDesc?.toISOString()} → ${afterDesc?.toISOString()}`
  );

  // **画面の並びまで通しで見る。** DBの列が動いても、キャッシュを飛ばし忘れれば画面は変わらない。
  //
  // **先に別のアルバムを上げてから試す。** 作ったばかりのアルバムは何もしなくても
  // 先頭に来るので、そのまま順位を見ても「投稿で上がったのか、新しいから上にいるのか」が
  // 区別できない（最初そう書いて、修正を外したビルドでも通ってしまった）。
  const order = async () => {
    const page = await api(`/groups/${group.id}`, { cookie: adminCookie });
    return {
      touched: page.text.indexOf("更新順テスト用アルバム"),
      seeded: page.text.indexOf("エルデンリング"),
    };
  };

  await uploadTo(album.id); // seedのアルバムを先に上げる
  const before = await order();
  await uploadTo(touchAlbumId); // こちらへ投稿したら入れ替わるはず
  const after = await order();

  check(
    "F133 投稿したアルバムがグループ画面で更新順の先頭に来る",
    before.seeded >= 0 &&
      before.touched > before.seeded && // 投稿前は下にいる
      after.touched >= 0 &&
      after.touched < after.seeded, // 投稿後は上に来る
    `投稿前 テスト用=${before.touched} エルデンリング=${before.seeded} / 投稿後 テスト用=${after.touched} エルデンリング=${after.seeded}`
  );

  // 後片付けはAPI経由で（DB直で消すとキャッシュに残って次のスイートを壊す。lessons.md）
  if (touchAlbumId) {
    await api(`/api/albums/${touchAlbumId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ───────────────────────────────────────────────────────────
// Botが落ちていた間の遡り取り込み（apps/bot の catchUp）
// ───────────────────────────────────────────────────────────
//
// **Discordには繋がない。** 偽のクライアント（guilds → channels → messages.fetch）を渡して、
// 取り込みの経路（catchUp → ingest API → Photo）だけを本物で通す。
// Botのコードはこれまで一切テストされておらず、実機でしか確認できなかった。
{
  const { catchUpMissedMessages } = await import("../../apps/bot/dist/lib/catchUp.js");

  /**
   * 添付付きメッセージの偽物。discord.js の Message のうち、取り込みが読む分だけ持たせる。
   * **タグを付けない**ので、取り込まれた写真は未分類のまま（アルバムに入らない）。
   * アルバムのキャッシュに載らないので、後片付けをDB直で消しても次のスイートを壊さない
   * （載るものはAPI経由で消す。lessons.md）。
   */
  const fakeMessage = (id, { bot = false, attachments = 1, contentType = "image/png", content = "", size = 1024 } = {}) => ({
    id,
    author: { bot, id: "100000000000000002", tag: "tester" },
    content,
    channelId: "700000000000000001",
    guildId: group.guildId,
    createdTimestamp: Date.now(),
    attachments: new Map(
      Array.from({ length: attachments }, (_, i) => [
        `a${i}`,
        {
          id: `att-${id}-${i}`,
          url: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
          contentType,
          size,
          name: "clipboard.png",
        },
      ])
    ),
  });

  const fakeClient = (messages) => {
    const channel = {
      type: 0, // ChannelType.GuildText
      name: "general",
      permissionsFor: () => ({ has: () => true }),
      messages: {
        // `after` 付きの取得。2回目以降は空を返して打ち切る（ページングの終わり）
        fetch: async ({ after }) => (after === "served" ? new Map() : new Map(messages.map((m) => [m.id, m]))),
      },
    };
    return {
      guilds: {
        cache: new Map([
          [
            "g1",
            {
              members: { me: {} },
              channels: { cache: new Map([["c1", channel]]) },
            },
          ],
        ]),
      },
    };
  };

  const photoCount = () => db.photo.count({ where: { discordMessageId: { startsWith: "catchup-" } } });

  // **前回の生存報告が無ければ遡らない**（どこまで戻ればよいか分からないため）
  const noPrevious = await catchUpMissedMessages(fakeClient([fakeMessage("catchup-1")]), null);
  check(
    "F134 前回の生存報告が無ければ遡らない",
    noPrevious.since === null && noPrevious.ingestedAttachments === 0,
    JSON.stringify(noPrevious)
  );

  // **落ちていた間のメッセージが取り込まれること**（これが本題）
  const before = await photoCount();
  const ran = await catchUpMissedMessages(
    fakeClient([fakeMessage("catchup-2"), fakeMessage("catchup-3")]),
    new Date(Date.now() - 60 * 60 * 1000) // 1時間前まで生きていた
  );
  const after = await photoCount();
  check(
    "F135 落ちていた間の投稿が遡って取り込まれる",
    ran.ingestedAttachments === 2 && after === before + 2,
    `${JSON.stringify(ran)} / Photo ${before} → ${after}`
  );

  // **2回流しても重複しない**（discordMessageId のユニーク制約で弾かれる）
  await catchUpMissedMessages(
    fakeClient([fakeMessage("catchup-2"), fakeMessage("catchup-3")]),
    new Date(Date.now() - 60 * 60 * 1000)
  );
  const afterTwice = await photoCount();
  check(
    "F136 同じメッセージを二度遡っても重複しない",
    afterTwice === after,
    `${after} → ${afterTwice}`
  );

  // **Bot自身の投稿と、添付の無いメッセージは対象外**（messageCreate と同じ条件）
  const beforeSkip = await photoCount();
  const skipped = await catchUpMissedMessages(
    fakeClient([
      fakeMessage("catchup-bot", { bot: true }),
      fakeMessage("catchup-empty", { attachments: 0 }),
      fakeMessage("catchup-pdf", { contentType: "application/pdf" }),
      fakeMessage("catchup-bigvideo", { contentType: "video/mp4", size: 40 * 1024 * 1024 }),
    ]),
    new Date(Date.now() - 60 * 60 * 1000)
  );
  const afterSkip = await photoCount();
  check(
    "F137 Botの投稿・添付なし・非対応形式・大きすぎる動画は取り込まない",
    skipped.ingestedAttachments === 0 && afterSkip === beforeSkip,
    `${JSON.stringify(skipped)} / Photo ${beforeSkip} → ${afterSkip}`
  );

  // **長く落ちていても遡りすぎない**（起点が7日前で頭打ちになる）
  const longDown = await catchUpMissedMessages(
    fakeClient([]),
    new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) // 60日前
  );
  const days = (Date.now() - longDown.since.getTime()) / 86400000;
  check(
    "F138 長く落ちていても遡りは7日で打ち切る",
    days > 6.9 && days < 7.1,
    `${days.toFixed(2)} 日前まで遡ろうとした`
  );

  // **起点は生存報告の「更新前の時刻」で渡される。** ここが常に null になると
  // Botは永久に遡らなくなる（しかも静かに）ので、APIの戻り値も見ておく
  const beat1 = await api("/api/internal/bot-heartbeat", {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
  });
  const seenAfterFirst = (await db.botHeartbeat.findUnique({ where: { id: "bot" } }))?.lastSeenAt;
  const beat2 = await api("/api/internal/bot-heartbeat", {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
  });
  check(
    "F139 生存報告は更新前の時刻を返す（遡りの起点になる）",
    beat1.status === 200 &&
      beat2.status === 200 &&
      !!beat2.json?.previousSeenAt &&
      new Date(beat2.json.previousSeenAt).getTime() === seenAfterFirst?.getTime(),
    `previousSeenAt=${beat2.json?.previousSeenAt} / DB=${seenAfterFirst?.toISOString()}`
  );

  await db.photo.deleteMany({ where: { discordMessageId: { startsWith: "catchup-" } } });
}

const summary = writeResults("flows", "F: 主要導線", results);
console.table(results.filter((r) => !r.ok));
await db.$disconnect();
process.exitCode = summary.failed > 0 ? 1 : 0;
