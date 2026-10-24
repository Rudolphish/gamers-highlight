// 主要な導線を実際に通して、DBの状態まで確認する統合テスト。
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeResults } from "./_results.mjs";
import { showsNotFound } from "./_notFound.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.NEXTAUTH_SECRET ?? "local-integration-test-secret";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "local-internal-secret";
const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron-secret";
const db = new PrismaClient();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

  // 上限の境目（2026-09-06に 30MB/30秒 → 100MB/2分 へ引き上げた）。
  // **ちょうどの値が通ることまで見る。** 「超えたら413」だけだと、
  // 比較が > か >= かを取り違えても気づけない（上限ちょうどのファイルが弾かれる）。
  // 正本は apps/web/src/lib/media-limits.ts。ここはTSをimportできないので写している
  // （上限を変えるとこの4件が落ちる。落ちたら値を合わせる）
  const MAX_SEC = 120;
  const MAX_BYTES = 100 * 1024 * 1024;

  const exactLen = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: 100, durationSeconds: MAX_SEC },
  });
  check(`F142 ${MAX_SEC}秒ちょうどの動画は通る`, exactLen.status === 201, exactLen.status);

  const overLen = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: 100, durationSeconds: MAX_SEC + 1 },
  });
  check(`F143 ${MAX_SEC + 1}秒の動画は413`, overLen.status === 413, overLen.status);

  const exactSize = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: MAX_BYTES },
  });
  check("F144 100MBちょうどの動画は通る", exactSize.status === 201, exactSize.status);

  const overSize = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: MAX_BYTES + 1 },
  });
  check("F145 100MBを1バイト超えた動画は413", overSize.status === 413, overSize.status);

  // 長さを測れない動画（duration が Infinity で返るwebmなど）は durationSeconds を送らない。
  // ここで弾くと正常な短い動画まで上げられなくなるので、送られてこない場合は判定しない。
  const noDuration = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: 100 },
  });
  check("F146 長さを送らない動画は通る（測れないファイルがあるため）", noDuration.status === 201, noDuration.status);

  // **小数の長さ。** Photo.durationSeconds は Int だが、Prismaは弾かずに0方向へ
  // 切り捨てる（5.22で実測: 12.9 → 12）。エラーにならないので気づけない。
  // サーバー側で四捨五入しているので 12.9 は 13 になる。**12.9 を使うのが要点**で、
  // 12.34 のような値だと切り捨てでも四捨五入でも同じ12になり、丸めを外しても通ってしまう。
  const fractional = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "video/mp4", sizeBytes: 12, durationSeconds: 12.9 },
  });
  const fracPhoto = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: {
      contentType: "video/mp4",
      mediaUrl: fractional.json.publicUrl,
      sizeBytes: 12,
      durationSeconds: 12.9,
      albumId: album.id,
    },
  });
  check(
    "F147 小数の長さは四捨五入して保存される（Prismaの切り捨てに任せない）",
    fracPhoto.status === 201 && fracPhoto.json?.photo?.durationSeconds === 13,
    `${fracPhoto.status} ${JSON.stringify(fracPhoto.json?.photo?.durationSeconds)}`
  );
  // 片付けはAPI経由で行う（DB直で消すとキャッシュ無効化が走らず、
  // 後ろのブラウザスイートが消えた写真をクリックして落ちる。実際に踏んだ）
  if (fracPhoto.json?.photo?.id) {
    await api(`/api/photos/${fracPhoto.json.photo.id}`, { method: "DELETE", cookie: adminCookie });
  }
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

  // 「ねらってる」
  const interest = await api(`/api/groups/${group.id}/games/${game.id}/interest`, {
    method: "POST",
    cookie: memberCookie,
  });
  check("F36 「ねらってる」を付けられる", interest.status === 200 || interest.status === 201, interest.text);
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

  const runHealthCron = () =>
    api("/api/cron/check-bot-health", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

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

  // **Botの死活は管理者向けのチャンネル（エラー通知先）へ1通だけ送る。**
  // グループの通知先には送らない——運用の話で、グループのメンバーには関係がないため。
  //
  // **「落ちている」状態を作ってから見る。** Botが生きていると通知の分岐に入らず、
  // 応答に notified が入らない。最初それに気づかず、壊し方と無関係に落ちるテストを書いた。
  {
    const heartbeatBefore = await db.botHeartbeat.findUnique({ where: { id: "bot" } });
    await db.botHeartbeat.deleteMany({ where: { id: "bot" } }); // 一度も生存報告が無い＝落ちている扱い

    // グループ側に通知先があっても、管理者側が未設定なら誰にも送らない
    await db.group.updateMany({ data: { notificationChannelId: "900000000000000055" } });
    await db.appSetting.deleteMany({ where: { key: "errorNotifyChannelId" } });
    const downNoAdmin = JSON.parse((await runHealthCron()).text);
    check(
      "F183 Bot死活はグループの通知先には送らない（管理者側が未設定なら誰にも送らない）",
      downNoAdmin.down === true && downNoAdmin.notified === 0,
      JSON.stringify({ down: downNoAdmin.down, notified: downNoAdmin.notified })
    );

    // 管理者側を設定すると、グループ数に関係なく1通だけ
    await db.appSetting.upsert({
      where: { key: "errorNotifyChannelId" },
      create: { key: "errorNotifyChannelId", value: "900000000000000066" },
      update: { value: "900000000000000066" },
    });
    const downWithAdmin = JSON.parse((await runHealthCron()).text);
    check(
      "F184 Bot死活は管理者の通知先へ1通だけ送る",
      downWithAdmin.notified === 1,
      JSON.stringify({ notified: downWithAdmin.notified })
    );

    // 後片付け（生存報告と設定を元に戻す）
    await db.appSetting.deleteMany({ where: { key: "errorNotifyChannelId" } });
    await db.group.updateMany({ data: { notificationChannelId: null } });
    if (heartbeatBefore) {
      await db.botHeartbeat.create({ data: heartbeatBefore });
    }
  }
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
    !byOutsider.text.includes("エルデンリング") && showsNotFound(byOutsider.text),
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
    !groupByOutsider.text.includes("テストグループ") && showsNotFound(groupByOutsider.text),
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
    "F72 プレイ中以外（プレイ予定・積みゲー・クリア済み）は出ない",
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

  // 週次まとめの送り先は**グループごと**（GroupNotificationTarget の WEEKLY_SUMMARY）。
  // 管理者の weeklySummaryChannelId は手動送信（確認）の宛先としてだけ残っている。
  const weeklyKey = `weeklySummaryLastSentWeek:${group.id}`;
  const setWeeklyTarget = (channelId) =>
    api(`/api/groups/${group.id}/notifications`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { kind: "WEEKLY_SUMMARY", channelId },
    });
  await setWeeklyTarget("");
  await db.appSetting.deleteMany({ where: { key: weeklyKey } });

  // **通知先が未設定なら送らない。しかも「送信済み」にもしない。**
  // 記録を進めてしまうと、後からチャンネルを設定してもその週は飛ばされる
  let mark = discordCount();
  await runCron();
  const unsetRecord = await setting(weeklyKey);
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
  // ここからはグループ側の通知先を設定して確かめる（自動送信はこちらを見る）
  await setWeeklyTarget("900000000000000011");
  const cronRes = await runCron();
  const weekly = JSON.parse(cronRes.text).weekly;
  check(
    "F114 未送信の完了週があれば、曜日に関係なくその週を対象にする",
    weekly?.week === expectedWeekKey,
    `返り値=${JSON.stringify(weekly)} / 期待=${expectedWeekKey}`
  );

  // **記録はグループごとに付く。** 全体で1つだと、1グループへの投稿が失敗しただけで
  // 全グループへ再送することになる
  const perGroupRecord = await setting(weeklyKey);
  check(
    "F181 送信済みの記録がグループごとに付く",
    perGroupRecord?.value === expectedWeekKey,
    `記録=${perGroupRecord?.value ?? "なし"} / 期待=${expectedWeekKey}`
  );

  // **管理者側の設定は自動送信に使われない**（手動送信の宛先として残っているだけ）
  const legacyRecord = await setting("weeklySummaryLastSentWeek");
  check(
    "F182 自動送信は全体の記録を進めない（グループごとの記録だけを使う）",
    legacyRecord === null,
    `記録=${legacyRecord?.value ?? "なし"}`
  );

  // **二度は送らない。** cronは毎日走るので、ここが効かないと毎日届く。
  // 記録を直接入れてから確認する（cronの投稿が成功したかに左右されないように）。
  await db.appSetting.upsert({
    where: { key: weeklyKey },
    create: { key: weeklyKey, value: expectedWeekKey },
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
  const before = await setting(weeklyKey);
  mark = discordCount();
  const manual = await api("/api/admin/weekly-notify", {
    method: "POST",
    cookie: adminCookie,
    body: { week: -1 },
  });
  const after = await setting(weeklyKey);
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

  // 後片付け。**グループ側の通知先も戻す**——残すと後続のcronがここへ送り続け、
  // 別のスイートが数える投稿件数がずれる
  await setWeeklyTarget("");
  await db.activityLog.deleteMany({ where: { targetId: { startsWith: "weekly-" } } });
  await db.appSetting.deleteMany({
    where: { key: { in: ["weeklySummaryChannelId", "weeklySummaryLastSentWeek", weeklyKey] } },
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
    // 選んだ日の内訳のチップ。件数は属性に持たせてある（絵文字をやめてアイコンにしたので、文字では拾えない。デザイン刷新の段階2）
    const m = res.text.match(/data-day-kind="photo\.created" data-count="(\d+)"/);
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
  // **Botのモジュールは読み込んだ瞬間に環境変数を掴む**（apiClient の BASE_URL / SECRET）。
  // import より前に入れておかないと `undefined/api/discord/ingest` を叩きに行く。
  // 手元では .env.local をシェルに読み込んでいるので気づけず、CIで初めて落ちた
  process.env.INTERNAL_API_BASE_URL ??= BASE;
  process.env.INTERNAL_API_SECRET ??= INTERNAL_SECRET;
  const { catchUpMissedMessages } = await import("../../apps/bot/dist/lib/catchUp.js");
  // 上限値もBot本体から取る。ベタ書きしていたせいで、上限を30MB→100MBに上げたとき
  // 「大きすぎる動画」のつもりの40MBが通ってしまい、F137が落ちた
  const { MAX_VIDEO_SIZE_BYTES } = await import("../../apps/bot/dist/lib/mediaLimits.js");

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
      fakeMessage("catchup-bigvideo", { contentType: "video/mp4", size: MAX_VIDEO_SIZE_BYTES + 1 }),
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

// ───────────────────────────────────────────────────────────
// アルバム一覧にグループが付いて返る（振り分け先の取り違え対策）
// ───────────────────────────────────────────────────────────
{
  const list = await api("/api/albums", { cookie: adminCookie });
  const first = list.json?.albums?.[0] ?? null;
  check(
    "F140 アルバム一覧はグループも返す（名前だけで選ばせないため）",
    list.status === 200 && !!first?.groupId && !!first?.group?.name,
    JSON.stringify({ groupId: first?.groupId, group: first?.group })
  );

  // 判別結果にもグループ名が付くこと（同名アルバムがあると、名前だけでは気づけない）
  const identified = await api("/api/photos/identify", {
    method: "POST",
    cookie: adminCookie,
    body: { appIds: [1245620] },
  });
  const withAlbum = (identified.json?.results ?? []).find((r) => r.album);
  check(
    "F141 ファイル名からの判別結果にもグループ名が付く",
    identified.status === 200 && (!withAlbum || typeof withAlbum.album.groupName === "string"),
    JSON.stringify(withAlbum?.album ?? identified.json?.results ?? null)
  );
}

// ───────────────────────────────────────────────────────────
// U. アルバム名の変更（PATCH /api/albums/:id）
// ───────────────────────────────────────────────────────────
{
  // 自分のグループに専用のアルバムを作って試す（seedのアルバムを書き換えると
  // 後ろのスイートが名前で探せなくなる）
  const created = await api("/api/albums", {
    method: "POST",
    cookie: adminCookie,
    body: { title: "改名前アルバム", description: "説明は消えてはいけない", groupId: group.id },
  });
  const target = created.json?.album?.id;
  check("F148 テスト用アルバムを作れる", created.status === 201 && Boolean(target), created.text);

  // サムネイル用のapp IDも入れておく。名前だけ送ったときに巻き添えで消えないことを見るため
  await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { steamAppId: 1245620 },
  });

  const renamed = await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { title: "改名後アルバム" },
  });
  const afterRename = await db.album.findUnique({ where: { id: target } });
  check(
    "F149 オーナーはアルバム名を変えられる",
    renamed.status === 200 && afterRename?.title === "改名後アルバム",
    `${renamed.status} ${afterRename?.title}`
  );

  // **名前だけ送ったときに他の項目を巻き添えにしない。**
  // `description: body.description ?? null` のように書くと、名前を変えただけで
  // 説明とサムネイルが消える（送っていない項目は undefined のまま渡す必要がある）
  check(
    "F150 名前だけ変えても説明とサムネイルは消えない",
    afterRename?.description === "説明は消えてはいけない" && afterRename?.steamAppId === 1245620,
    `description=${afterRename?.description} steamAppId=${afterRename?.steamAppId}`
  );

  // 検証が無かった頃は空文字がそのまま保存でき、名前の無いアルバムが作れた
  const empty = await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { title: "   " },
  });
  const afterEmpty = await db.album.findUnique({ where: { id: target } });
  check(
    "F151 空のアルバム名は400（名前は消えない）",
    empty.status === 400 && afterEmpty?.title === "改名後アルバム",
    `${empty.status} ${afterEmpty?.title}`
  );

  const tooLong = await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { title: "あ".repeat(101) },
  });
  check("F152 100文字を超えるアルバム名は400", tooLong.status === 400, tooLong.status);

  // **グループの権限は配下のアルバムに VIEWER までしか効かない。**
  // member はグループのEDITORだが、このアルバムには招待されていないので変えられない
  const byGroupMember = await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: memberCookie,
    body: { title: "勝手に改名" },
  });
  check(
    "F153 グループの編集者というだけでは他人のアルバム名を変えられない",
    byGroupMember.status === 403,
    byGroupMember.status
  );

  // 改名の前にグループ画面を1回開いて、古い名前をキャッシュに載せておく（F155 のため）。
  // 開かずに改名すると、キャッシュが空のまま最初の描画で新しい名前を読むので、無効化を消しても F155 が通ってしまう
  // （2026-10-18 に無効化を外したビルドで確かめて分かった。「期待する結果と同じ初期状態から始めない」docs/lessons.md）
  const warm = await (await fetch(`${BASE}/groups/${group.id}`, { headers: { cookie: adminCookie } })).text();
  const warmAt = warm.indexOf(`href="/albums/${target}"`);
  // この時点の名前は「改名後アルバム」（F149 で一度変えている）
  const warmedWithOldName = warmAt >= 0 && warm.slice(warmAt, warm.indexOf("</a>", warmAt)).includes("改名後アルバム");

  // アルバム単位で編集者として招待されていれば変えられる（APIの条件はEDITOR以上）
  const member = await db.user.findUnique({ where: { email: "member@example.com" } });
  await db.albumMember.create({ data: { albumId: target, userId: member.id, role: "EDITOR" } });
  const byAlbumEditor = await api(`/api/albums/${target}`, {
    method: "PATCH",
    cookie: memberCookie,
    body: { title: "編集者が改名" },
  });
  const afterEditor = await db.album.findUnique({ where: { id: target } });
  check(
    "F154 アルバムの編集者はアルバム名を変えられる",
    byAlbumEditor.status === 200 && afterEditor?.title === "編集者が改名",
    `${byAlbumEditor.status} ${afterEditor?.title}`
  );

  // 名前はグループ詳細のアルバム一覧にも出る。無効化を忘れると古い名前が残る
  const groupPage = await fetch(`${BASE}/groups/${group.id}`, { headers: { cookie: adminCookie } });
  // **アルバム一覧のカードだけを見る。** ページ全体で古い名前を探すと、「最近の動き」の「アルバムを作成」の行に当たる
  // （出来事の記録には作った時点の名前が残る。ActivityLog.targetName は改名しても書き換えない）。しかも同じ文字列は
  // サーバーが描いた木のデータとして <script> の中にも入るので、欄を切り取っても消えない（切り取る形では、キャッシュが正しくても古い名前が見つかって落ちた）
  const groupHtml = await groupPage.text();
  const cardAt = groupHtml.indexOf(`href="/albums/${target}"`);
  const card = cardAt < 0 ? "" : groupHtml.slice(cardAt, groupHtml.indexOf("</a>", cardAt));
  check(
    "F155 変えた名前がグループ画面に出る（キャッシュが残らない）",
    warmedWithOldName && card.includes("編集者が改名") && !card.includes("改名後アルバム"),
    `改名前に古い名前が出ていた=${warmedWithOldName} / カード=${cardAt >= 0} 新しい名前=${card.includes("編集者が改名")} 古い名前=${card.includes("改名後アルバム")}`
  );

  // 後片付け。作ったときと同じ経路（API）で消す
  await api(`/api/albums/${target}`, { method: "DELETE", cookie: adminCookie });
}

// ───────────────────────────────────────────────────────────
// V. YouTube動画の投稿（POST /api/photos の youtubeUrl 経路）
// ───────────────────────────────────────────────────────────
{
  // **正規形に直して保存する。** 再生位置やプレイリストが付いたURLを
  // そのまま保存すると、同じ動画かどうかがURLの比較では分からなくなる
  const posted = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: {
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxxxx",
      albumId: album.id,
      gameTitle: "YouTubeテスト",
    },
  });
  const youtubePhotoId = posted.json?.photo?.id ?? null;
  check(
    "F156 YouTubeのURLを投稿できる（余計なパラメータは落として保存する）",
    posted.status === 201 &&
      posted.json?.photo?.mediaType === "YOUTUBE" &&
      posted.json?.photo?.mediaUrl === "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    `${posted.status} ${posted.json?.photo?.mediaUrl}`
  );

  check(
    "F157 サムネイルは動画IDから組み立てられ、容量と長さは持たない",
    posted.json?.photo?.thumbnailUrl === "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" &&
      posted.json?.photo?.sizeBytes === null &&
      posted.json?.photo?.durationSeconds === null,
    JSON.stringify({
      thumbnailUrl: posted.json?.photo?.thumbnailUrl,
      sizeBytes: posted.json?.photo?.sizeBytes,
      durationSeconds: posted.json?.photo?.durationSeconds,
    })
  );

  // 短縮形・Shorts も同じIDに解決する（共有ボタンが返す形を全部通す）
  const short = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { youtubeUrl: "https://youtu.be/abcdefghijk" },
  });
  const shorts = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { youtubeUrl: "https://www.youtube.com/shorts/abcdefghijk" },
  });
  check(
    "F158 youtu.be と shorts のURLも同じ正規形になる",
    short.status === 201 &&
      shorts.status === 201 &&
      short.json?.photo?.mediaUrl === "https://www.youtube.com/watch?v=abcdefghijk" &&
      shorts.json?.photo?.mediaUrl === "https://www.youtube.com/watch?v=abcdefghijk",
    `${short.json?.photo?.mediaUrl} / ${shorts.json?.photo?.mediaUrl}`
  );

  // **YouTube以外のURLを保存できてはいけない。** ここが緩いと任意のURLを
  // mediaUrl として保存できる（自前ストレージの検証を通らない経路なので特に効く）
  for (const [id, bad] of [
    ["F159", "https://example.com/watch?v=dQw4w9WgXcQ"],
    ["F160", "https://www.youtube.com/watch?v=short"],
    ["F161", "javascript:alert(1)"],
  ]) {
    const res = await api("/api/photos", {
      method: "POST",
      cookie: adminCookie,
      body: { youtubeUrl: bad },
    });
    check(`${id} YouTube以外のURLは400（${bad.slice(0, 40)}）`, res.status === 400, res.status);
  }

  // 上限はかからない（長い動画を置く先として用意した経路なので）
  const noLimit = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { youtubeUrl: "https://www.youtube.com/watch?v=zzzzzzzzzzz", durationSeconds: 99999, sizeBytes: 999999999 },
  });
  check(
    "F162 YouTubeにはサイズ・長さの上限がかからない",
    noLimit.status === 201 && noLimit.json?.photo?.sizeBytes === null,
    `${noLimit.status} ${noLimit.json?.photo?.sizeBytes}`
  );

  // 他人のアルバムには入れられない（通常の投稿と同じ判定を通っていること）
  const outsiderAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });
  const intrude = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", albumId: outsiderAlbum.id },
  });
  check("F163 権限の無いアルバムへのYouTube投稿は403", intrude.status === 403, intrude.status);

  // **アルバムのカバーには使わない。** 使うとアルバムの見た目がYouTube側の画像に置き換わる。
  //
  // **Steam連携のあるアルバムで試してはいけない。** そちらはヘッダー画像が優先されるので、
  // 直っていなくてもYouTubeがカバーに出ず、テストが通ってしまう。
  // 連携の無いアルバムを作り、画像 → YouTube の順に入れて「いちばん新しいのはYouTube」の
  // 状態を作ってから見る。
  const coverAlbum = (
    await api("/api/albums", {
      method: "POST",
      cookie: adminCookie,
      body: { title: "カバー確認用アルバム", groupId: group.id },
    })
  ).json?.album?.id;
  const coverSigned = await api("/api/photos/upload-url", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", sizeBytes: 10 },
  });
  await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { contentType: "image/png", mediaUrl: coverSigned.json.publicUrl, albumId: coverAlbum },
  });
  const coverYoutube = await api("/api/photos", {
    method: "POST",
    cookie: adminCookie,
    body: { youtubeUrl: "https://www.youtube.com/watch?v=coverxxxxxx", albumId: coverAlbum },
  });
  const groupPage = await fetch(`${BASE}/groups/${group.id}`, { headers: { cookie: adminCookie } });
  const groupHtml = await groupPage.text();
  check(
    "F164 いちばん新しい投稿がYouTubeでも、アルバムのカバーには使われない",
    coverYoutube.status === 201 && !groupHtml.includes("i.ytimg.com"),
    groupHtml.includes("i.ytimg.com") ? "カバーに ytimg が出ている" : `${coverYoutube.status}`
  );
  // **同じ判定をAPIでも見る。** カバー候補を引くクエリは画面2箇所とAPI1箇所にあり、
  // 方針を1箇所に集約したとき**APIだけ見落としていた**（後追いレビューで発覚）。
  // 画面だけ確認していると通ってしまうので、両方から見る。
  const groupApi = await api(`/api/groups/${group.id}`, { cookie: adminCookie });
  const apiCovers = (groupApi.json?.group?.albums ?? []).flatMap((a) => a.photos ?? []);
  check(
    "F165 APIが返すカバー候補にもYouTubeは混ざらない",
    groupApi.status === 200 && apiCovers.every((p) => p.mediaType !== "YOUTUBE"),
    `${groupApi.status} ${JSON.stringify(apiCovers.map((p) => p.mediaType))}`
  );

  if (coverAlbum) await api(`/api/albums/${coverAlbum}`, { method: "DELETE", cookie: adminCookie });

  // 投稿数には数える（普通の投稿と同じ扱い）
  const adminUser = await db.user.findUnique({ where: { email: "admin@example.com" } });
  const youtubeCount = await db.photo.count({
    where: { uploaderId: adminUser.id, mediaType: "YOUTUBE" },
  });
  check("F166 YOUTUBE として保存されている", youtubeCount >= 4, `${youtubeCount}件`);

  // 後片付け（作ったときと同じ経路で消す）
  for (const id of [youtubePhotoId, short.json?.photo?.id, shorts.json?.photo?.id, noLimit.json?.photo?.id]) {
    if (id) await api(`/api/photos/${id}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ───────────────────────────────────────────────────────────
// W. 提案されたらDiscordへ通知する
// ───────────────────────────────────────────────────────────
{
  const fs = await import("node:fs");
  const DISCORD_LOG = "/tmp/stub-discord.log";
  const discordLines = () =>
    fs.existsSync(DISCORD_LOG)
      ? fs.readFileSync(DISCORD_LOG, "utf8").split("\n").filter(Boolean)
      : [];
  const bodiesSince = (mark) =>
    discordLines()
      .slice(mark)
      .map((line) => {
        try {
          return JSON.parse(JSON.parse(line).body ?? "{}").content ?? "";
        } catch {
          return "";
        }
      });

  // **seedのグループは使わない。** 通知先を設定したまま残すと、後のスイート
  // （Bot死活のcronや週次まとめ）が同じチャンネルへ投稿して件数が変わる。
  const created = await api("/api/groups", {
    method: "POST",
    cookie: adminCookie,
    // 通知先はグループのDiscordサーバーのチャンネルに限るので、サーバーを持たせる（スタブはどのサーバーにも同じ一覧を返す）
    body: { name: "提案通知テスト用グループ", guildId: "900000000000000555" },
  });
  const notifyGroupId = created.json?.group?.id ?? null;
  const CHANNEL = "900000000000000011";
  const setTarget = (kind, channelId) =>
    api(`/api/groups/${notifyGroupId}/notifications`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { kind, channelId },
    });
  await setTarget("PROPOSAL", CHANNEL);

  // **メンバーを1人足してから試す。** オーナーだけ（メンバー0）だと、必要数は
  // 正しい式でも「オーナー分の+1を落とした式」でも 1 になり、**壊しても通ってしまう**。
  // メンバー1人なら 2 と 1 に割れるので、式の間違いが結果に出る。
  await api(`/api/groups/${notifyGroupId}/members`, {
    method: "POST",
    cookie: adminCookie,
    body: { email: "member@example.com", role: "VIEWER" },
  });

  let mark = discordLines().length;
  const proposed = await api(`/api/groups/${notifyGroupId}/proposals`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 271590, title: "グランド・セフト・オートV" },
  });
  const sent = bodiesSince(mark);
  check(
    "F167 提案するとDiscordへ通知が飛ぶ",
    proposed.status === 201 && sent.length === 1,
    `${proposed.status} / 投稿=${sent.length}件`
  );

  // **中身まで見る。** 送ったことだけ確認しても、空文字を送っていたら気づけない
  check(
    "F168 通知にゲーム名と提案者が入っている",
    sent[0]?.includes("グランド・セフト・オートV") && sent[0]?.includes("提案者"),
    sent[0] ?? "投稿なし"
  );

  // 価格通知と同じ方針：表示名が無くてもメールアドレスには落とさない
  check(
    "F169 通知にメールアドレスが混ざらない",
    !sent[0]?.includes("@example.com"),
    sent[0] ?? "投稿なし"
  );

  // **必要な「やりたい」の数は投票APIと同じ式で出す。**
  // オーナー1人＋メンバー1人＝母数2なので、必要数は floor(2/2)+1 = 2。
  // オーナー分の+1を落とすと 1 になるので、式が違えばここで割れる。
  // （seedのグループはオーナーもGroupMemberの行を持っていて本番と形が違うため、
  //   実運用と同じ「オーナーはmembersに入らない」グループを自分で作って確かめている）
  check(
    "F170 通知に必要な「やりたい」の数が入っている（投票APIと同じ式）",
    sent[0]?.includes("「やりたい」が 2 人集まると"),
    sent[0] ?? "投稿なし"
  );

  // 通知先が未設定なら送らない（既定はこちら。設定していないグループに勝手に投げない）
  await setTarget("PROPOSAL", "");
  mark = discordLines().length;
  const quiet = await api(`/api/groups/${notifyGroupId}/proposals`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 570, title: "Dota 2" },
  });
  check(
    "F171 通知先が未設定のグループでは送らない（提案自体は成功する）",
    quiet.status === 201 && bodiesSince(mark).length === 0,
    `${quiet.status} / 投稿=${bodiesSince(mark).length}件`
  );

  // Discordが落ちていても提案は成功する（通知の失敗で500にしない）
  // 設定はDiscordが生きているうちに済ませる（一覧が取れないと通知先を保存できない）
  await setTarget("PROPOSAL", CHANNEL);
  fs.writeFileSync("/tmp/stub-fail", "discord.com");
  const whenDown = await api(`/api/groups/${notifyGroupId}/proposals`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 1091500, title: "サイバーパンク2077" },
  });
  fs.unlinkSync("/tmp/stub-fail");
  check(
    "F172 Discordが落ちていても提案は成功する",
    whenDown.status === 201,
    whenDown.text
  );

  // **種類ごとに独立していること。** 提案だけをオンにしても、価格の通知先は空のまま。
  // ここが繋がっていると「1つ設定したら全部鳴る」という以前の挙動に戻る
  await setTarget("PROPOSAL", CHANNEL);
  const afterProposalOnly = await db.groupNotificationTarget.findMany({
    where: { groupId: notifyGroupId },
    select: { kind: true, channelId: true },
  });
  check(
    "F173 種類ごとに独立している（提案をオンにしても他の種類は空のまま）",
    afterProposalOnly.length === 1 && afterProposalOnly[0].kind === "PROPOSAL",
    JSON.stringify(afterProposalOnly)
  );

  // 種類ごとに違うチャンネルを指定できる
  const OTHER = "900000000000000012";
  await setTarget("PRICE_DROP", OTHER);
  const twoKinds = await db.groupNotificationTarget.findMany({
    where: { groupId: notifyGroupId },
    select: { kind: true, channelId: true },
    orderBy: { kind: "asc" },
  });
  check(
    "F174 種類ごとに別のチャンネルを指定できる",
    twoKinds.length === 2 &&
      twoKinds.find((t) => t.kind === "PROPOSAL")?.channelId === CHANNEL &&
      twoKinds.find((t) => t.kind === "PRICE_DROP")?.channelId === OTHER,
    JSON.stringify(twoKinds)
  );

  // 「送らない」に戻すと行ごと消える（送らないための特別な値を作らない）
  await setTarget("PRICE_DROP", "");
  const afterOff = await db.groupNotificationTarget.count({
    where: { groupId: notifyGroupId, kind: "PRICE_DROP" },
  });
  check("F175 「送らない」に戻すと設定が消える", afterOff === 0, `${afterOff}件`);

  // 設定が無い状態で「送らない」を選び直しても落ちない
  const offAgain = await setTarget("PRICE_DROP", "");
  check("F176 未設定のまま「送らない」を選んでも成功する", offAgain.status === 200, offAgain.text);

  // チャンネルIDの形が違えば400（誤入力をそのまま保存しない）
  const bad = await setTarget("PROPOSAL", "not-a-snowflake");
  check("F177 チャンネルIDの形が違えば400", bad.status === 400, bad.status);

  // オーナー以外は変えられない（通知先はグループ全員の目に触れる場所を決める設定）
  const byMember = await api(`/api/groups/${notifyGroupId}/notifications`, {
    method: "PATCH",
    cookie: memberCookie,
    body: { kind: "PROPOSAL", channelId: CHANNEL },
  });
  check("F178 オーナー以外は通知先を変えられない", byMember.status === 403, byMember.status);

  // **送り先はグループのDiscordサーバーのチャンネルに限る。** 形式だけ見ていた頃は、
  // Botが入っている別サーバーのチャンネルIDを書けば、そこへグループの通知を流せた
  const beforeForeign = await db.groupNotificationTarget.findMany({ where: { groupId: notifyGroupId }, select: { kind: true, channelId: true } });
  const foreign = await setTarget("PRICE_DROP", "900000000000000099");
  const voice = await setTarget("PRICE_DROP", "900000000000000014");
  const afterForeign = await db.groupNotificationTarget.findMany({ where: { groupId: notifyGroupId }, select: { kind: true, channelId: true } });
  check(
    "F284 グループのサーバーに無いチャンネル・投稿できないチャンネル（ボイス）は400で、保存もされない",
    foreign.status === 400 && voice.status === 400 && JSON.stringify(afterForeign) === JSON.stringify(beforeForeign),
    `別サーバー=${foreign.status} / ボイス=${voice.status} / 前=${JSON.stringify(beforeForeign)} 後=${JSON.stringify(afterForeign)}`
  );

  // 一覧が取れないときも通さない（取れないから素通し、だと「Botが入っていないサーバー」を
  // 名乗ったグループを作るだけで検証を外せる）。「送らない」だけはいつでも選べる
  const noGuild = await api("/api/groups", { method: "POST", cookie: adminCookie, body: { name: "サーバー未設定の通知テスト" } });
  const noGuildId = noGuild.json?.group?.id ?? null;
  const noGuildSet = await api(`/api/groups/${noGuildId}/notifications`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { kind: "PROPOSAL", channelId: CHANNEL },
  });
  if (noGuildId) await api(`/api/groups/${noGuildId}`, { method: "DELETE", cookie: adminCookie });
  fs.writeFileSync("/tmp/stub-fail", "discord.com");
  const downSet = await setTarget("PRICE_DROP", "900000000000000013");
  const downClear = await setTarget("WEEKLY_SUMMARY", "");
  fs.rmSync("/tmp/stub-fail", { force: true });
  check(
    "F285 サーバー未設定のグループ・Discordが落ちているときは通知先を設定できない（409）が、「送らない」は選べる",
    noGuildSet.status === 409 && downSet.status === 409 && downClear.status === 200,
    `サーバー未設定=${noGuildSet.status} / 障害中=${downSet.status} / 障害中の送らない=${downClear.status}`
  );

  // **別の種類の設定を、提案の通知先として使ってしまわないこと。**
  // 種類ごとに分けた意味がここにある。読み取り側が種類を見ていないと、
  // 「価格の通知先しか設定していないのに提案の通知が飛ぶ」ことになる
  await setTarget("PROPOSAL", "");
  await setTarget("PRICE_DROP", CHANNEL);
  mark = discordLines().length;
  const otherKindOnly = await api(`/api/groups/${notifyGroupId}/proposals`, {
    method: "POST",
    cookie: adminCookie,
    body: { steamAppId: 1174180, title: "レッド・デッド・リデンプション2" },
  });
  check(
    "F180 価格の通知先しか設定していなければ、提案の通知は飛ばない",
    otherKindOnly.status === 201 && bodiesSince(mark).length === 0,
    `${otherKindOnly.status} / 投稿=${bodiesSince(mark).length}件`
  );

  // 後片付け（作ったときと同じ経路で消す）
  if (notifyGroupId) {
    await api(`/api/groups/${notifyGroupId}`, { method: "DELETE", cookie: adminCookie });
  }

  // グループを消したら通知の設定も消える（残ると、消えたグループ宛の設定が溜まる）
  const orphan = await db.groupNotificationTarget.count({ where: { groupId: notifyGroupId } });
  check("F179 グループを消すと通知の設定も消える", orphan === 0, `${orphan}件`);
}

// ───────────────────────────────────────────────────────────
// 提案の順位（提案者ごとの区画の並び）
//
// **提案者本人だけが並べ替えられる**こと、順位が「その人の中で1..n」に詰め直されること、
// 順位なしが新しい順で後ろに続くこと、を見る。
// ───────────────────────────────────────────────────────────
{
  // 専用のグループを作る。既存のテストグループには他のスイートが提案を足すので、
  // 「この人の提案だけで1..n」を数えるには自分で用意したほうが確実
  const made = await api("/api/groups", {
    method: "POST",
    cookie: adminCookie,
    body: { name: `順位テスト用グループ-${randomUUID().slice(0, 8)}` },
  });
  const rankGroupId = made.json?.group?.id ?? null;
  check("F185 順位テスト用のグループを作れる", !!rankGroupId, made.text);

  // member も提案できるようにメンバーへ加える。
  // **このAPIが受け取るのは userId ではなく email**（`members/route.ts`）。
  // userId を渡すと body.email が undefined のまま Prisma に渡り、400ではなく500が返る
  const added = await api(`/api/groups/${rankGroupId}/members`, {
    method: "POST",
    cookie: adminCookie,
    body: { email: "member@example.com", role: "VIEWER" },
  });
  check("F185b memberをグループに追加できる", added.status === 201, `${added.status} ${added.text.slice(0, 120)}`);

  /** 提案を1件作ってIDを返す。作成順に意味があるので順番に呼ぶ */
  async function propose(cookie, steamAppId, title) {
    const res = await api(`/api/groups/${rankGroupId}/proposals`, {
      method: "POST",
      cookie,
      body: { steamAppId, title },
    });
    return res.json?.proposal?.id ?? null;
  }

  // admin が4件、member が1件。admin の4件は作成順に a1→a4（a4がいちばん新しい）
  const a1 = await propose(adminCookie, 570, "Dota 2");
  const a2 = await propose(adminCookie, 440, "Team Fortress 2");
  const a3 = await propose(adminCookie, 730, "Counter-Strike 2");
  const a4 = await propose(adminCookie, 252490, "Rust");
  const m1 = await propose(memberCookie, 892970, "Valheim");
  check("F186 提案を5件作れる", [a1, a2, a3, a4, m1].every(Boolean), `${a1},${a2},${a3},${a4},${m1}`);

  const setRank = (proposalId, rank, cookie = adminCookie) =>
    api(`/api/groups/${rankGroupId}/proposals/${proposalId}/rank`, {
      method: "PATCH",
      cookie,
      body: { rank },
    });

  /** admin の提案を順位順（順位なしは新しい順）で並べてIDの配列にする */
  async function adminOrder() {
    const rows = await db.groupGameProposal.findMany({
      where: { groupId: rankGroupId, proposedById: (await db.user.findUnique({ where: { email: "admin@example.com" } })).id },
      select: { id: true, rank: true, createdAt: true },
    });
    return rows
      .sort((x, y) => {
        if (x.rank !== null && y.rank !== null) return x.rank - y.rank;
        if (x.rank !== null) return -1;
        if (y.rank !== null) return 1;
        return y.createdAt.getTime() - x.createdAt.getTime();
      })
      .map((r) => r.id);
  }

  // 順位を付けていない状態は新しい順（a4, a3, a2, a1）
  check(
    "F187 順位が無いうちは新しい順で並ぶ",
    JSON.stringify(await adminOrder()) === JSON.stringify([a4, a3, a2, a1]),
    JSON.stringify(await adminOrder())
  );

  // a1 を1位にすると、a1 が先頭。残りは新しい順のまま後ろに続く
  const r1 = await setRank(a1, 1);
  check(
    "F188 1位を付けた提案が先頭に来る",
    r1.status === 200 && JSON.stringify(await adminOrder()) === JSON.stringify([a1, a4, a3, a2]),
    `${r1.status} / ${JSON.stringify(await adminOrder())}`
  );

  // a2 を1位にすると a1 は2位へ押し出される。**番号は1,2と詰まっていること**
  await setRank(a2, 1);
  const ranksAfter = await db.groupGameProposal.findMany({
    where: { groupId: rankGroupId, rank: { not: null } },
    select: { id: true, rank: true },
    orderBy: { rank: "asc" },
  });
  check(
    "F189 割り込むと既存の順位が押し出され、1..nに詰まる",
    JSON.stringify(ranksAfter.map((r) => [r.id, r.rank])) === JSON.stringify([[a2, 1], [a1, 2]]),
    JSON.stringify(ranksAfter.map((r) => [r.id, r.rank]))
  );

  // 件数を超える順位（5位）を指定しても、歯抜けにならず末尾（3位）になる
  await setRank(a3, 5);
  const clamped = await db.groupGameProposal.findUnique({ where: { id: a3 }, select: { rank: true } });
  check("F190 件数を超える順位は末尾に詰められる", clamped.rank === 3, `${clamped.rank}`);

  // 順位なしに戻すと、後ろが詰まる（a1:2位 → 1位、a3:3位 → 2位）
  await setRank(a2, null);
  const afterClear = await db.groupGameProposal.findMany({
    where: { groupId: rankGroupId, rank: { not: null } },
    select: { id: true, rank: true },
    orderBy: { rank: "asc" },
  });
  check(
    "F191 順位なしに戻すと後続が詰まる",
    JSON.stringify(afterClear.map((r) => [r.id, r.rank])) === JSON.stringify([[a1, 1], [a3, 2]]),
    JSON.stringify(afterClear.map((r) => [r.id, r.rank]))
  );

  // **他人の提案の順位は変えられない。** 区画はその人のウィッシュリストなので、
  // オーナー（このグループの作成者＝admin）であっても他人の並びは触れない
  const otherUsers = await setRank(m1, 1, adminCookie);
  check("F192 他人の提案の順位は変えられない（オーナーでも403）", otherUsers.status === 403, otherUsers.status);

  const memberOwn = await setRank(m1, 1, memberCookie);
  check("F193 自分の提案なら順位を付けられる", memberOwn.status === 200, memberOwn.text);

  // 他人が1位を付けても、こちらの区画の順位は動かない（区画は独立している）
  const adminStill = await db.groupGameProposal.findUnique({ where: { id: a1 }, select: { rank: true } });
  check("F194 他人の順位付けは自分の区画に影響しない", adminStill.rank === 1, `${adminStill.rank}`);

  // 範囲外・型違いは400
  const tooBig = await setRank(a1, 1000);
  check("F195 範囲外の順位は400", tooBig.status === 400, tooBig.status);

  // 未ログインは401
  const anon = await api(`/api/groups/${rankGroupId}/proposals/${a1}/rank`, {
    method: "PATCH",
    body: { rank: 1 },
  });
  check("F196 未ログインでは順位を変えられない", anon.status === 401, anon.status);

  // 後片付け（作ったときと同じ経路で消す）
  if (rankGroupId) {
    await api(`/api/groups/${rankGroupId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ───────────────────────────────────────────────────────────
// アルバムとゲームの連携の付け替え・解除
//
// **間違えた連携を直す経路。** これが無かったため、アルバムから辿るゲーム詳細が
// 別のゲームのまま固定されていた（ユーザー報告）。
// 他スイートの状態に寄りかからないよう、専用のグループとアルバムを作って試す。
// ───────────────────────────────────────────────────────────
{
  const made = await api("/api/groups", {
    method: "POST",
    cookie: adminCookie,
    body: { name: `連携テスト用グループ-${randomUUID().slice(0, 8)}` },
  });
  const linkGroupId = made.json?.group?.id ?? null;

  const madeAlbum = await api("/api/albums", {
    method: "POST",
    cookie: adminCookie,
    body: { title: "連携テスト用アルバム", groupId: linkGroupId },
  });
  const linkAlbumId = madeAlbum.json?.album?.id ?? null;
  check("F197 連携テスト用のグループとアルバムを作れる", !!linkGroupId && !!linkAlbumId, `${made.text.slice(0, 80)} / ${madeAlbum.text.slice(0, 80)}`);

  const relink = (body) =>
    api(`/api/albums/${linkAlbumId}/game`, { method: "PATCH", cookie: adminCookie, body });

  /** そのアルバムに紐付いているゲーム（無ければ null） */
  const linkedGame = () =>
    db.groupGame.findUnique({
      where: { albumId: linkAlbumId },
      select: { id: true, steamAppId: true, title: true },
    });

  // 最初の連携（リストに無いゲーム → 新しく作られる）
  const first = await relink({ steamAppId: 1091500, title: "Cyberpunk 2077" });
  const afterFirst = await linkedGame();
  check(
    "F198 リストに無いゲームへの連携で、ゲームが作られて紐付く",
    first.status === 200 && afterFirst?.steamAppId === 1091500,
    `${first.status} / ${afterFirst?.steamAppId}`
  );

  // サムネイル（Album.steamAppId）も連携先に合う
  const albumAfterFirst = await db.album.findUnique({
    where: { id: linkAlbumId },
    select: { steamAppId: true },
  });
  check(
    "F199 連携するとアルバムのサムネイルも同じゲームになる",
    albumAfterFirst?.steamAppId === 1091500,
    `${albumAfterFirst?.steamAppId}`
  );

  // **付け替え。** 既定では元のゲームをリストから消さない
  const second = await relink({ steamAppId: 570, title: "Dota 2" });
  const afterSecond = await linkedGame();
  const previousStillListed = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: linkGroupId, steamAppId: 1091500 } },
    select: { albumId: true },
  });
  check(
    "F200 別のゲームへ付け替えられる（元のゲームはリストに残る）",
    second.status === 200 && afterSecond?.steamAppId === 570 && !!previousStillListed,
    `${second.status} / 連携=${afterSecond?.steamAppId} / 元=${previousStillListed ? "残っている" : "消えた"}`
  );

  // **二重に紐付かない。** 外してから付けているので、元のゲームの albumId は null
  check(
    "F201 付け替え後、元のゲームの紐付けは外れている",
    previousStillListed?.albumId === null,
    `${previousStillListed?.albumId}`
  );

  // 同じゲームをもう一度指定しても壊れない（冪等）
  const again = await relink({ steamAppId: 570, title: "Dota 2" });
  check(
    "F202 同じゲームへの連携は冪等",
    again.status === 200 && (await linkedGame())?.steamAppId === 570,
    `${again.status}`
  );

  // **他のアルバムの連携は奪わない。** もう1つアルバムを作って別のゲームと連携させ、
  // そのゲームへ付け替えようとすると409
  const otherAlbum = await api("/api/albums", {
    method: "POST",
    cookie: adminCookie,
    body: { title: "連携テスト用アルバム2", groupId: linkGroupId },
  });
  const otherAlbumId = otherAlbum.json?.album?.id ?? null;
  await api(`/api/albums/${otherAlbumId}/game`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { steamAppId: 1174180, title: "レッド・デッド・リデンプション2" },
  });
  const steal = await relink({ steamAppId: 1174180, title: "レッド・デッド・リデンプション2" });
  const stillOther = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: linkGroupId, steamAppId: 1174180 } },
    select: { albumId: true },
  });
  check(
    "F203 他のアルバムと連携しているゲームへは付け替えられない（409）",
    steal.status === 409 && stillOther?.albumId === otherAlbumId,
    `${steal.status} / ${stillOther?.albumId === otherAlbumId ? "相手の連携は無事" : "奪ってしまった"}`
  );

  // **removePrevious で元のゲームをリストから消す。** 画面では確認ダイアログを挟む操作
  const withRemoval = await relink({
    steamAppId: 1245620,
    title: "ELDEN RING",
    removePrevious: true,
  });
  const removed = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: linkGroupId, steamAppId: 570 } },
  });
  check(
    "F204 removePrevious を付けると元のゲームがリストから消える",
    withRemoval.status === 200 && removed === null && (await linkedGame())?.steamAppId === 1245620,
    `${withRemoval.status} / 元=${removed ? "残っている" : "消えた"}`
  );

  // 解除。ゲームはリストに残り、サムネイルも触らない
  const unlink = await relink({ steamAppId: null });
  const afterUnlink = await linkedGame();
  const gameStillThere = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId: linkGroupId, steamAppId: 1245620 } },
  });
  const albumAfterUnlink = await db.album.findUnique({
    where: { id: linkAlbumId },
    select: { steamAppId: true },
  });
  check(
    "F205 連携を解除できる（ゲームはリストに残り、サムネイルはそのまま）",
    unlink.status === 200 &&
      afterUnlink === null &&
      !!gameStillThere &&
      albumAfterUnlink?.steamAppId === 1245620,
    `${unlink.status} / 連携=${afterUnlink} / ゲーム=${gameStillThere ? "残" : "消"} / サムネ=${albumAfterUnlink?.steamAppId}`
  );

  // 連携が無い状態で解除しても落ちない
  const unlinkTwice = await relink({ steamAppId: null });
  check("F206 連携が無い状態の解除は何もしない", unlinkTwice.status === 200, unlinkTwice.status);

  // 範囲外・未ログイン・部外者
  const bad = await relink({ steamAppId: 0, title: "x" });
  check("F207 範囲外のapp IDは400", bad.status === 400, bad.status);

  const anon = await api(`/api/albums/${linkAlbumId}/game`, {
    method: "PATCH",
    body: { steamAppId: null },
  });
  check("F208 未ログインでは連携を変えられない", anon.status === 401, anon.status);

  const byOutsider = await api(`/api/albums/${linkAlbumId}/game`, {
    method: "PATCH",
    cookie: outsiderCookie,
    body: { steamAppId: null },
  });
  check("F209 部外者は連携を変えられない", byOutsider.status === 403, byOutsider.status);

  // **VIEWERでは変えられない。** ゲームリストを触る操作なのでEDITOR以上に揃えてある
  await api(`/api/groups/${linkGroupId}/members`, {
    method: "POST",
    cookie: adminCookie,
    body: { email: "member@example.com", role: "VIEWER" },
  });
  const byViewer = await api(`/api/albums/${linkAlbumId}/game`, {
    method: "PATCH",
    cookie: memberCookie,
    body: { steamAppId: 570, title: "Dota 2" },
  });
  check("F210 VIEWERは連携を変えられない（EDITOR以上）", byViewer.status === 403, byViewer.status);

  // 後片付け（グループを消すとアルバムもゲームも落ちる）
  if (linkGroupId) {
    await api(`/api/groups/${linkGroupId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ───────────────────────────────────────────────────────────
// プレイ記録（グループで一緒に遊んだ時間）。設計は docs/play-log.md
// ───────────────────────────────────────────────────────────
//
// **Discordには繋がない。** Botが送るスナップショットを偽装して内部APIへ直に送り、
// 行の開閉・対応付け・外れた人の扱いをDBで確かめる。検知の判定（VC＋プレイ状況 → 組）は
// Botの純粋関数を apps/bot/dist から読んで確かめる。
//
// プレイ記録はキャッシュに載せていないので、後片付けはDB直でよい（lessons.md の
// 「作ったデータは同じ経路で消す」はキャッシュに載るものの話）。
{
  const ADMIN = "100000000000000001";
  const MEMBER = "100000000000000002";
  const OUTSIDER = "100000000000000003";
  const VC = "800000000000000001";
  const VC2 = "800000000000000002";
  const WITCHER_APP = "510000000000000001";
  const UNKNOWN_APP = "510000000000000099";
  const guildId = group.guildId;
  const internal = { "x-internal-secret": INTERNAL_SECRET };

  const witcher = await db.groupGame.findFirst({ where: { groupId: group.id, steamAppId: 292030 } });
  const elden = await db.groupGame.findFirst({ where: { groupId: group.id, steamAppId: 1245620 } });

  const snapshot = (activities, extra = {}) =>
    api("/api/internal/play-log/snapshot", { method: "POST", headers: internal, body: { guildId, activities, ...extra } });
  const act = (name, applicationId, ids, { vc = VC, since = null } = {}) => ({
    voiceChannelId: vc,
    applicationId,
    name,
    participants: ids.map((discordUserId) => ({ discordUserId, since })),
  });
  const sessions = () =>
    db.groupPlaySession.findMany({ where: { groupId: group.id }, include: { participants: true }, orderBy: { createdAt: "asc" } });
  const opt = (discordUserId, action, g = guildId) =>
    api("/api/internal/play-log/opt", { method: "POST", headers: internal, body: { guildId: g, discordUserId, action } });

  // 前のスイートや前回の実行が残したものを消してから始める（CIは毎回まっさらだが、手元は同じDBに流す）
  await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  await db.playLogOptOut.deleteMany({ where: { groupId: group.id } });
  await db.discordAppSteamMapping.deleteMany({ where: { discordApplicationId: { in: [WITCHER_APP, UNKNOWN_APP] } } });
  // 進行中の行を「プレイ中」と出すかは生存報告の新しさで決まる。テストの間は新しくしておく
  await api("/api/internal/bot-heartbeat", { method: "POST", headers: internal });

  try {
    const noSecret = await api("/api/internal/play-log/snapshot", { method: "POST", body: { guildId, activities: [] } });
    check("F211 共有シークレットが無いとスナップショットを受け付けない", noSecret.status === 401, noSecret.status);

    const broken = await snapshot([{ voiceChannelId: "abc", name: "x", applicationId: null, participants: [] }]);
    check("F212 形の壊れたスナップショットは400", broken.status === 400, broken.status);

    const members = await api(`/api/internal/play-log/members?guildId=${guildId}`, { headers: internal });
    const ids = members.json?.discordUserIds ?? [];
    const noGroup = await api("/api/internal/play-log/members?guildId=999999999999999999", { headers: internal });
    check(
      "F213 対象者はグループのメンバーで連携済みの人だけ（部外者は入らない）",
      members.status === 200 && ids.includes(ADMIN) && ids.includes(MEMBER) && !ids.includes(OUTSIDER) && noGroup.json?.group === false,
      JSON.stringify({ ids, noGroup: noGroup.json })
    );

    // **1人だけでは数えない。** 部外者が一緒に遊んでいても人数に入らない
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, OUTSIDER])]);
    check("F214 ゲーム中が対象者1人だけなら記録しない（部外者は数に入らない）", (await sessions()).length === 0, (await sessions()).length);

    // 2人以上 → 開く。日本語名（GroupGame.title）で当たり、アプリIDの対応が保存される
    const first = await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER, OUTSIDER])]);
    let rows = await sessions();
    const participantIds = rows[0]?.participants.map((p) => p.userId).sort() ?? [];
    const adminUser = await db.user.findUnique({ where: { discordUserId: ADMIN } });
    const memberUser = await db.user.findUnique({ where: { discordUserId: MEMBER } });
    check(
      "F215 VCで2人以上が同じゲームなら記録が始まり、参加者は対象者だけ",
      first.status === 200 &&
        rows.length === 1 &&
        rows[0].endedAt === null &&
        participantIds.length === 2 &&
        participantIds.includes(adminUser.id) &&
        participantIds.includes(memberUser.id),
      JSON.stringify({ status: first.status, n: rows.length, participantIds })
    );
    const mapping = await db.discordAppSteamMapping.findUnique({ where: { discordApplicationId: WITCHER_APP } });
    check(
      "F216 日本語名で当たり、DiscordのアプリIDとSteamの対応が保存される",
      rows[0]?.groupGameId === witcher.id && mapping?.steamAppId === 292030,
      JSON.stringify({ game: rows[0]?.groupGameId, mapping })
    );

    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER])]);
    check("F217 同じ状態を送り直しても行は増えない（冪等）", (await sessions()).length === 1, (await sessions()).length);

    await snapshot([]);
    rows = await sessions();
    check(
      "F218 条件が崩れたら閉じ、参加者の退出時刻も入る",
      rows[0]?.endedAt !== null && rows[0]?.participants.every((p) => p.leftAt !== null),
      JSON.stringify(rows[0])
    );

    // **10分以内に戻ってきたら同じ1回として続ける**（クラッシュで一時的に1人になった等）
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER], { vc: VC2 })]);
    rows = await sessions();
    check(
      "F219 10分以内に同じゲームが戻ると同じ行を続ける（VCが変わっても）",
      rows.length === 1 && rows[0].endedAt === null && rows[0].voiceChannelId === VC2 && rows[0].participants.every((p) => p.leftAt === null),
      JSON.stringify(rows.map((r) => ({ endedAt: r.endedAt, vc: r.voiceChannelId })))
    );

    // 閉じて11分以上たった扱いにすると、次は別の1回になる。名前が違ってもアプリIDの対応（1段目）で当たる
    await snapshot([]);
    await db.groupPlaySession.updateMany({
      where: { groupId: group.id },
      data: { startedAt: new Date(Date.now() - 50 * 60 * 1000), endedAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    await snapshot([act("The Witcher 3 (renamed)", WITCHER_APP, [ADMIN, MEMBER])]);
    rows = await sessions();
    check(
      "F220 途切れが10分を超えると別の1回になり、アプリIDの対応で名前が違っても当たる",
      rows.length === 2 && rows[1].groupGameId === witcher.id,
      JSON.stringify(rows.map((r) => ({ game: r.groupGameId, name: r.activityName })))
    );
    await snapshot([]);

    // 2段目の英語名。アプリIDが無く、日本語名とも一致しない → appdetails の英語名で当たる
    await snapshot([act("The Witcher 3: Wild Hunt", null, [ADMIN, MEMBER])]);
    rows = await sessions();
    check(
      "F221 英語名（記号違い）でも当たる",
      rows.length === 3 && rows[2].groupGameId === witcher.id,
      JSON.stringify(rows.map((r) => ({ game: r.groupGameId, name: r.activityName })))
    );
    await snapshot([]);

    // 分からないゲーム → 名前だけ記録 → グループ画面に出る → メンバーが選ぶ → 過去分にも反映
    await snapshot([act("Mystery Game", UNKNOWN_APP, [ADMIN, MEMBER])]);
    await snapshot([]);
    rows = await sessions();
    const unknown = rows.find((r) => r.discordApplicationId === UNKNOWN_APP);
    const groupPage = await api(`/groups/${group.id}`, { cookie: memberCookie });
    check(
      "F222 当たらないゲームは名前だけ記録され、グループ画面に「ゲームが分からないプレイ」として出る",
      unknown?.groupGameId === null && groupPage.text.includes("ゲームが分からないプレイ") && groupPage.text.includes("Mystery Game"),
      `${unknown?.groupGameId} / ${groupPage.status}`
    );

    const byOutsider = await api(`/api/groups/${group.id}/play-log/assign`, {
      method: "POST",
      cookie: outsiderCookie,
      body: { gameKey: unknown?.gameKey, groupGameId: elden.id },
    });
    check("F223 部外者は結びつけられない", byOutsider.status === 403, byOutsider.status);

    const assigned = await api(`/api/groups/${group.id}/play-log/assign`, {
      method: "POST",
      cookie: memberCookie,
      body: { gameKey: unknown?.gameKey, groupGameId: elden.id },
    });
    const afterAssign = await db.groupPlaySession.findUnique({ where: { id: unknown?.id ?? "" } });
    const savedMapping = await db.discordAppSteamMapping.findUnique({ where: { discordApplicationId: UNKNOWN_APP } });
    check(
      "F224 メンバーが選ぶと過去分に反映され、次から自動で当たるよう対応が保存される",
      assigned.status === 200 && afterAssign?.groupGameId === elden.id && savedMapping?.steamAppId === 1245620,
      JSON.stringify({ status: assigned.status, game: afterAssign?.groupGameId, savedMapping })
    );

    // 外れる・戻る
    const off = await opt(MEMBER, "off");
    const membersAfterOff = await api(`/api/internal/play-log/members?guildId=${guildId}`, { headers: internal });
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER])]);
    // **行の数では見ない。** 直前に閉じた同じゲームの行が10分以内なら「続き」として開き直すので、
    // 数えてしまっても行は増えない（壊して確かめたら、行数の条件だけでは落ちなかった）
    const openAfterOff = await db.groupPlaySession.count({ where: { groupId: group.id, endedAt: null } });
    check(
      "F225 /playlog off で外れた人は数えない（2人いても記録が始まらない）",
      off.json?.status === "opted-out" &&
        !(membersAfterOff.json?.discordUserIds ?? []).includes(MEMBER) &&
        openAfterOff === 0,
      JSON.stringify({ off: off.json, ids: membersAfterOff.json?.discordUserIds, open: openAfterOff })
    );
    const pastStillThere = await db.groupPlayParticipant.count({ where: { userId: memberUser.id } });
    check("F226 外れても過去の参加記録は残る", pastStillThere > 0, pastStillThere);

    const on = await opt(MEMBER, "on");
    const status = await opt(MEMBER, "status");
    const unlinked = await opt("100000000000000777", "status");
    const notMember = await opt(OUTSIDER, "status");
    const noGroupOpt = await opt(MEMBER, "status", "999999999999999999");
    check(
      "F227 /playlog の状態（戻す・連携なし・メンバー外・グループなし）",
      on.json?.status === "counted" &&
        status.json?.status === "counted" &&
        unlinked.json?.status === "unlinked" &&
        notMember.json?.status === "not-member" &&
        noGroupOpt.json?.status === "no-group",
      JSON.stringify([on.json, status.json, unlinked.json, notMember.json, noGroupOpt.json])
    );

    // Botの再起動。進行中の行を「前回生きていた時刻」で閉じ、推定の印を付ける
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER])]);
    const openRow = (await sessions())[0];
    const lastSeen = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.groupPlaySession.update({ where: { id: openRow.id }, data: { startedAt: new Date(lastSeen.getTime() - 60 * 60 * 1000) } });
    const started = await api("/api/internal/play-log/bot-started", {
      method: "POST",
      headers: internal,
      body: { previousSeenAt: lastSeen.toISOString() },
    });
    let closedRow = await db.groupPlaySession.findUnique({ where: { id: openRow.id } });
    check(
      "F228 Botの起動時、進行中の行は前回生きていた時刻で閉じられ「推定」になる",
      started.json?.closed === 1 && closedRow?.estimated === true && closedRow?.endedAt?.getTime() === lastSeen.getTime(),
      JSON.stringify({ started: started.json, closedRow })
    );

    // 開始時刻が分からない組はつながない（一晩落ちていた間を「遊んでいた」にしない）
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER])], { resumeAfter: lastSeen.toISOString() });
    rows = await sessions();
    check(
      "F229 開始時刻が分からなければ、落ちていた間はつながず別の1回にする",
      rows.length === 2 && rows[0].endedAt !== null,
      JSON.stringify(rows.map((r) => ({ endedAt: r.endedAt, estimated: r.estimated })))
    );

    // 落ちる前から続いていた組（since が前回生きていた時刻より前）は、閉じた行の続きとしてつなぐ
    await db.groupPlaySession.deleteMany({ where: { id: rows[1]?.id ?? "" } });
    const since = lastSeen.getTime() - 30 * 60 * 1000;
    await snapshot([act("ウィッチャー3", WITCHER_APP, [ADMIN, MEMBER], { since })], { resumeAfter: lastSeen.toISOString() });
    rows = await sessions();
    check(
      "F230 落ちる前から遊び続けていた組は、閉じた行の続きとしてつなぐ（推定のまま）",
      rows.length === 1 && rows[0].id === openRow.id && rows[0].endedAt === null && rows[0].estimated === true,
      JSON.stringify(rows.map((r) => ({ id: r.id === openRow.id, endedAt: r.endedAt, estimated: r.estimated })))
    );
    await snapshot([]);

    // 開始時刻が分かるのが1人だけ（もう1人は「オンライン状態を隠す」でプレイ中が見えない）でも、
    // その1人が落ちる前から遊んでいればつなぐ。10分以内の再開で拾われないよう、閉じた行は作り直す
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    const estRow = await db.groupPlaySession.create({
      data: {
        groupId: group.id,
        groupGameId: openRow.groupGameId,
        gameKey: openRow.gameKey,
        discordApplicationId: WITCHER_APP,
        activityName: "ウィッチャー3",
        voiceChannelId: VC,
        startedAt: new Date(lastSeen.getTime() - 60 * 60 * 1000),
        endedAt: lastSeen,
        estimated: true,
      },
    });
    await snapshot(
      [
        {
          voiceChannelId: VC,
          applicationId: WITCHER_APP,
          name: "ウィッチャー3",
          participants: [
            { discordUserId: ADMIN, since },
            { discordUserId: MEMBER, since: null },
          ],
        },
      ],
      { resumeAfter: lastSeen.toISOString() }
    );
    rows = await sessions();
    check(
      "F269 開始時刻が分かるのが1人だけの組でも、落ちる前から遊んでいれば閉じた行の続きとしてつなぐ",
      rows.length === 1 && rows[0].id === estRow.id && rows[0].endedAt === null,
      JSON.stringify(rows.map((r) => ({ id: r.id === estRow.id, endedAt: r.endedAt })))
    );
    await snapshot([]);

    // ゲーム詳細に出る。5分未満は一覧に出さず、合計には含める
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    const mk = (startMinAgo, minutes) =>
      db.groupPlaySession.create({
        data: {
          groupId: group.id,
          groupGameId: witcher.id,
          gameKey: `app:${WITCHER_APP}`,
          discordApplicationId: WITCHER_APP,
          activityName: "ウィッチャー3",
          voiceChannelId: VC,
          startedAt: new Date(Date.now() - startMinAgo * 60 * 1000),
          endedAt: new Date(Date.now() - (startMinAgo - minutes) * 60 * 1000),
          participants: {
            create: [
              { userId: adminUser.id, joinedAt: new Date(Date.now() - startMinAgo * 60 * 1000) },
              { userId: memberUser.id, joinedAt: new Date(Date.now() - startMinAgo * 60 * 1000) },
            ],
          },
        },
      });
    await mk(300, 90); // 90分
    await mk(100, 3); // 3分（一覧には出さない）
    const detail = await api(`/groups/${group.id}/games/${witcher.id}`, { cookie: memberCookie });
    // 一覧の区画の中だけを数える（ページの他の場所の <li> を拾わないように）
    const listHtml = detail.text.split('data-testid="group-play-sessions"')[1]?.split("</ul>")[0] ?? "";
    const listCount = (listHtml.match(/<li /g) ?? []).length;
    check(
      "F231 ゲーム詳細に合計（5分未満も含む）と参加者が出て、5分未満は一覧に出ない",
      detail.status === 200 &&
        detail.text.includes("グループで遊んだ時間") &&
        detail.text.includes("1時間33分") &&
        listHtml.includes("管理者ユーザー") &&
        listHtml.includes("一般メンバー") &&
        listCount === 1,
      `${detail.status} / 合計=${detail.text.includes("1時間33分")} / 一覧=${listCount}`
    );
  } catch (e) {
    // **途中で落ちても後ろのスイートと表を道連れにしない。** 例外のまま抜けると flows 全体が止まり、
    // 結果の表も書かれない（壊して確かめたとき F230 の手前で実際にそうなった）
    check("F211x プレイ記録のブロックが途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    await db.playLogOptOut.deleteMany({ where: { groupId: group.id } });
    await db.discordAppSteamMapping.deleteMany({ where: { discordApplicationId: { in: [WITCHER_APP, UNKNOWN_APP] } } });
  }

  // 検知の判定（Botの純粋関数）
  const { computePlayingGroups, snapshotSignature } = await import("../../apps/bot/dist/lib/playLog.js");
  const playing = (name, applicationId, startedAt = null) => ({ type: 0, name, applicationId, startedAt });
  const presences = {
    a: [playing("Game A", "1")],
    b: [playing("Game A", "1"), { type: 2, name: "Spotify", applicationId: null, startedAt: null }],
    c: [playing("Game A", "1")],
    d: [playing("Game B", null)],
    e: [playing("Game B", null)],
    x: [playing("Game A", "1")],
  };
  const voice = [
    { userId: "a", channelId: "v1" },
    { userId: "b", channelId: "v1" },
    { userId: "x", channelId: "v1" },
    { userId: "c", channelId: "v2" },
    { userId: "d", channelId: "v2" },
    { userId: "e", channelId: "v2" },
  ];
  const groups = computePlayingGroups(voice, (id) => presences[id] ?? [], new Set(["a", "b", "c", "d", "e"]));
  check(
    "F232 Botの判定：同じVC・同じゲームの対象者2人以上だけが組になる（対象外・別VCの1人・音楽は数えない）",
    groups.length === 2 &&
      groups[0].voiceChannelId === "v1" &&
      groups[0].participants.map((p) => p.discordUserId).join(",") === "a,b" &&
      groups[1].voiceChannelId === "v2" &&
      groups[1].name === "Game B" &&
      groups[1].participants.length === 2,
    JSON.stringify(groups)
  );

  // 「オンライン状態を隠す」の人はBotからプレイ中が見えない。見えているゲームが1つだけのVCでは数える
  const hidden = computePlayingGroups(
    [
      { userId: "a", channelId: "v1" },
      { userId: "b", channelId: "v1" },
      { userId: "c", channelId: "v1" },
      { userId: "x", channelId: "v1" },
      { userId: "d", channelId: "v2" },
      { userId: "e", channelId: "v2" },
      { userId: "f", channelId: "v2" },
      { userId: "g", channelId: "v3" },
      { userId: "h", channelId: "v3" },
    ],
    (id) => ({ a: [playing("Game A", "1", 5)], d: [playing("Game A", "1")], e: [playing("Game B", null)] })[id] ?? [],
    new Set(["a", "b", "c", "d", "e", "f", "g", "h"])
  );
  check(
    "F268 Botの判定：プレイ中が見えない対象者も、VCで見えているゲームが1つならその組に数える（2つ以上・誰も見えないVCは数えない・対象外は入れない）",
    hidden.length === 1 &&
      hidden[0].voiceChannelId === "v1" &&
      hidden[0].participants.map((p) => `${p.discordUserId}:${p.since}`).join(",") === "a:5,b:null,c:null",
    JSON.stringify(hidden)
  );

  const sigA = snapshotSignature(computePlayingGroups(voice, (id) => presences[id] ?? [], new Set(["a", "b"])));
  const withSince = { ...presences, a: [playing("Game A", "1", 123)] };
  const sigB = snapshotSignature(computePlayingGroups(voice, (id) => withSince[id] ?? [], new Set(["a", "b"])));
  check("F233 Botの判定：開始時刻が揺れただけでは送り直さない", sigA === sigB, `${sigA} / ${sigB}`);

  // `/playlog status` の診断表示（4人で遊んだのに0件だった件の切り分け用）
  const { describePlayStatus } = await import("../../apps/bot/dist/lib/playLog.js");
  const NOW = 1_800_000_000_000;
  const view = (inVoice, extra = {}) =>
    describePlayStatus({
      now: NOW,
      ready: true,
      eligibleCount: 4,
      minParticipants: 2,
      membersFetchedAt: NOW - 60_000,
      voiceChannelId: "v1",
      voiceChannelName: "雑談",
      inVoice,
      lastSend: { at: NOW - 120_000, ok: true, groups: 0 },
      askerPlayingHere: true,
      askerPlayingElsewhere: [],
      ...extra,
    });

  const silentText = view([
    { userId: "a", eligible: true, activities: [playing("Game A", "1")] },
    { userId: "b", eligible: true, activities: [] },
    { userId: "x", eligible: false, activities: [playing("秘密のゲーム", "9")] },
  ]);
  check(
    "F264 /playlog status：プレイ中が届いていない対象者を名指しし、隠す設定などの確認を促す（対象外の人のゲームは出さない）",
    /<@b>：\*\*プレイ中が届いていません/.test(silentText) &&
      silentText.includes("アクティビティのプライバシー") &&
      silentText.includes("オンライン状態を隠す") &&
      // サーバーごとの設定（2026-10-24。週末ゲーミングで全員分が届かなかった原因）
      silentText.includes("「プライバシー設定」→「アクティビティのステータス」") &&
      silentText.includes("<@x>：対象外") &&
      !silentText.includes("秘密のゲーム") &&
      // 見えないbも、ゲームが1つなのでその組に数える（F268 と同じ判定）
      silentText.includes("いま記録される組：Game A（2人）"),
    silentText
  );

  const splitText = view([
    { userId: "a", eligible: true, activities: [playing("Game A", "1")] },
    { userId: "b", eligible: true, activities: [playing("game a", null)] },
  ]);
  const okText = view([
    { userId: "a", eligible: true, activities: [playing("Game A", "1")] },
    { userId: "b", eligible: true, activities: [playing("Game A", "1")] },
  ]);
  check(
    "F265 /playlog status：同じ名前でアプリIDが違うと「別のゲームとして数えている」と出す（揃っていれば組として出す）",
    splitText.includes("別のゲームとして数えています") &&
      !splitText.includes("いま記録される組") &&
      okText.includes("いま記録される組：Game A（2人）") &&
      !okText.includes("別のゲームとして") &&
      !okText.includes("プレイ中が届いていません"),
    `${splitText}\n---\n${okText}`
  );

  const failedText = view([], {
    voiceChannelId: null,
    lastSend: { at: NOW - 180_000, ok: false, groups: 1, reason: "HTTP 500 boom" },
  });
  const notFetched = view([], { eligibleCount: null, membersFetchedAt: null, lastSend: null });
  check(
    "F266 /playlog status：送信の失敗は理由つきで出す・対象者を取れていない・まだ送っていない、も区別して出す",
    failedText.includes("**失敗**（HTTP 500 boom）") &&
      failedText.includes("VCに入っていません") &&
      notFetched.includes("対象者の一覧をWebから取れていません") &&
      notFetched.includes("まだ一度もしていません"),
    `${failedText}\n---\n${notFetched}`
  );
  // 最少人数（管理者がテスト用に1人へ切り替えたとき）。既定の2人では1人のプレイは組にならない
  const solo = (min) =>
    computePlayingGroups([{ userId: "a", channelId: "v1" }], () => [playing("Game A", "1")], new Set(["a"]), min);
  const soloStatus = view([{ userId: "a", eligible: true, activities: [playing("Game A", "1")] }], { minParticipants: 1 });
  check(
    "F275 Botの判定：最少人数が1人のときだけ、1人のプレイも組になる（/playlog status にも最少人数が出る）",
    solo(1).length === 1 &&
      solo(undefined).length === 0 &&
      solo(2).length === 0 &&
      soloStatus.includes("いま記録される組：Game A（1人）") &&
      soloStatus.includes("記録の最少人数：1人"),
    JSON.stringify({ one: solo(1), def: solo(undefined) }) + "\n" + soloStatus
  );
}

// ── プレイ記録の通知（種類 PLAY_LOG） ──
// 開始は行を作った瞬間、終了は閉じて10分戻らなかったら（生存報告のついでに拾う）。
// Discordへの投稿はスタブが /tmp/stub-discord.log に本文ごと残すので、それで見る
{
  const fs = await import("node:fs");
  const DISCORD_LOG = "/tmp/stub-discord.log";
  const ADMIN = "100000000000000001";
  const MEMBER = "100000000000000002";
  const VC = "800000000000000005";
  const APP = "510000000000000055";
  const internal = { "x-internal-secret": INTERNAL_SECRET };
  const posts = () =>
    (fs.existsSync(DISCORD_LOG) ? fs.readFileSync(DISCORD_LOG, "utf8").split("\n").filter(Boolean) : []).map(
      (l) => JSON.parse(JSON.parse(l).body ?? "{}").content ?? ""
    );
  const postsSince = (mark) => posts().slice(mark);
  const snapshot = (participants) =>
    api("/api/internal/play-log/snapshot", {
      method: "POST",
      headers: internal,
      body: {
        guildId: group.guildId,
        activities: participants.length
          ? [{ voiceChannelId: VC, applicationId: APP, name: "通知テストのゲーム", participants: participants.map((d) => ({ discordUserId: d, since: null })) }]
          : [],
      },
    });
  const heartbeat = () => api("/api/internal/bot-heartbeat", { method: "POST", headers: internal });
  const setTarget = (channelId) =>
    api(`/api/groups/${group.id}/notifications`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { kind: "PLAY_LOG", channelId },
    });
  const rows = () => db.groupPlaySession.findMany({ where: { groupId: group.id }, orderBy: { createdAt: "asc" } });
  const backdate = (id, startMinAgo, endMinAgo) =>
    db.groupPlaySession.update({
      where: { id },
      data: { startedAt: new Date(Date.now() - startMinAgo * 60000), endedAt: new Date(Date.now() - endMinAgo * 60000) },
    });

  await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  await heartbeat(); // 次の生存報告を「途切れていない」扱いにする（長く落ちていた後の最初の報告では終了を送らない）

  try {
    // 送り先が無い間は何も送らない
    let mark = posts().length;
    await snapshot([ADMIN, MEMBER]);
    const silent = postsSince(mark).filter((c) => c.includes("通知テストのゲーム"));
    await snapshot([]);
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });

    await setTarget("900000000000000011");
    mark = posts().length;
    await snapshot([ADMIN, MEMBER]);
    await snapshot([ADMIN, MEMBER]); // 同じ状態の送り直し（冪等）で二重に出ないこと
    const started = postsSince(mark).filter((c) => c.includes("通知テストのゲーム"));
    check(
      "F270 プレイ記録が始まると通知チャンネルへ「記録を始めました」と参加者が1回だけ出る（送り先が無ければ出ない）",
      silent.length === 0 && started.length === 1 && started[0].includes("記録を始めました") && started[0].includes("参加:"),
      JSON.stringify({ silent, started })
    );

    // 閉じた直後は送らない → 10分戻らなかったら、生存報告のついでに終了を送る
    mark = posts().length;
    await snapshot([]);
    await heartbeat();
    const tooEarly = postsSince(mark).filter((c) => c.includes("遊びました"));
    let [row] = await rows();
    await backdate(row.id, 71, 11);
    await heartbeat();
    await heartbeat(); // 2回目で二重に送らないこと
    const ended = postsSince(mark).filter((c) => c.includes("遊びました"));
    [row] = await rows();
    check(
      "F271 終了は閉じてすぐには出さず、10分戻らなかったら遊んだ時間つきで1回だけ出る",
      tooEarly.length === 0 &&
        ended.length === 1 &&
        ended[0].includes("通知テストのゲーム") &&
        ended[0].includes("1時間") &&
        row.endNotifiedAt !== null,
      JSON.stringify({ tooEarly, ended, endNotifiedAt: row.endNotifiedAt })
    );

    // 途切れて10分以内に戻った回は、終了も2回目の開始も出さない（同じ1回として続く）
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    mark = posts().length;
    await snapshot([ADMIN, MEMBER]);
    await snapshot([]);
    await snapshot([ADMIN, MEMBER]);
    await heartbeat();
    const resumed = postsSince(mark).filter((c) => c.includes("通知テストのゲーム"));
    check(
      "F272 途切れて10分以内に戻った回は、終了も2回目の開始も出さない",
      resumed.length === 1 && resumed[0].includes("記録を始めました") && (await rows()).length === 1,
      JSON.stringify(resumed)
    );
    await snapshot([]);

    // Discordへの投稿に失敗したら「送った」にせず、次の生存報告で送り直す
    [row] = await rows();
    await backdate(row.id, 30, 12);
    mark = posts().length;
    fs.writeFileSync("/tmp/stub-fail", "discord.com");
    try {
      await heartbeat();
    } finally {
      fs.rmSync("/tmp/stub-fail", { force: true });
    }
    const afterFail = (await rows())[0];
    await heartbeat();
    const retried = postsSince(mark).filter((c) => c.includes("遊びました"));
    check(
      "F273 終了の通知に失敗したら「送った」の印を戻し、次の生存報告で送り直す",
      afterFail.endNotifiedAt === null && retried.length === 1 && (await rows())[0].endNotifiedAt !== null,
      JSON.stringify({ afterFail: afterFail.endNotifiedAt, retried })
    );

    // 長く落ちていた後の最初の生存報告では終了を送らない（直後の起動処理でつなぎ直されうる）。2回目からは送る
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    await snapshot([ADMIN, MEMBER]);
    await snapshot([]);
    [row] = await rows();
    await backdate(row.id, 40, 15);
    await db.botHeartbeat.update({ where: { id: "bot" }, data: { lastSeenAt: new Date(Date.now() - 60 * 60000) } });
    mark = posts().length;
    await heartbeat();
    const afterDown = postsSince(mark).filter((c) => c.includes("遊びました"));
    await heartbeat();
    const afterUp = postsSince(mark).filter((c) => c.includes("遊びました"));
    check(
      "F274 Botが長く落ちていた後の最初の生存報告では終了を送らず、次の報告で送る",
      afterDown.length === 0 && afterUp.length === 1,
      JSON.stringify({ afterDown, afterUp })
    );
  } catch (e) {
    check("F270x プレイ記録の通知の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    fs.rmSync("/tmp/stub-fail", { force: true });
    await setTarget("");
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  }
}

// ── プレイ記録の最少人数（管理者だけがテスト用に1人へ切り替えられる） ──
{
  const internal = { "x-internal-secret": INTERNAL_SECRET };
  const settings = (cookie, body) =>
    api(`/api/groups/${group.id}/play-log/settings`, { method: "PATCH", cookie, body });
  const members = async () =>
    JSON.parse((await api(`/api/internal/play-log/members?guildId=${group.guildId}`, { headers: internal })).text);
  const soloSnapshot = (on) =>
    api("/api/internal/play-log/snapshot", {
      method: "POST",
      headers: internal,
      body: {
        guildId: group.guildId,
        activities: on
          ? [{ voiceChannelId: "800000000000000006", applicationId: "510000000000000066", name: "ソロ確認のゲーム", participants: [{ discordUserId: "100000000000000001", since: null }] }]
          : [],
      },
    });
  const rows = () => db.groupPlaySession.findMany({ where: { groupId: group.id } });

  await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  try {
    const byMember = await settings(memberCookie, { minParticipants: 1 });
    const invalid = await settings(adminCookie, { minParticipants: 3 });
    const before = await members();
    await soloSnapshot(true);
    const soloAt2 = (await rows()).length;
    await soloSnapshot(false);

    const set1 = await settings(adminCookie, { minParticipants: 1 });
    const after = await members();
    await soloSnapshot(true);
    const soloAt1 = await rows();
    await soloSnapshot(false);
    // 最少人数の切り替えはグループの設定画面（歯車の先）にある（デザイン刷新の段階5でグループ画面から移した）
    const groupPage = await api(`/groups/${group.id}/settings`, { cookie: adminCookie });
    const memberPage = await api(`/groups/${group.id}/settings`, { cookie: memberCookie });

    check(
      "F276 最少人数は管理者だけが1人に切り替えられ、Botへの一覧に載り、1人のプレイも記録される（既定の2人では記録されない）",
      byMember.status === 403 &&
        invalid.status === 400 &&
        before.minParticipants === 2 &&
        soloAt2 === 0 &&
        set1.status === 200 &&
        after.minParticipants === 1 &&
        soloAt1.length === 1 &&
        soloAt1[0].activityName === "ソロ確認のゲーム" &&
        groupPage.text.includes("プレイ記録の最少人数") &&
        !memberPage.text.includes("プレイ記録の最少人数"),
      JSON.stringify({
        byMember: byMember.status,
        invalid: invalid.status,
        before: before.minParticipants,
        soloAt2,
        set1: set1.status,
        after: after.minParticipants,
        soloAt1: soloAt1.length,
        adminSees: groupPage.text.includes("プレイ記録の最少人数"),
        memberSees: memberPage.text.includes("プレイ記録の最少人数"),
      })
    );
  } catch (e) {
    check("F276x 最少人数の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    await settings(adminCookie, { minParticipants: 2 });
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  }
}

// ── 管理者が他の人の未分類を振り分ける（/admin/media） ──
// メンバーが手動で上げた未分類の投稿を用意し、管理者だけが移せること・既にアルバムにある投稿は
// 管理者でも動かないこと・一覧の「未分類のみ」に出ることを見る。作った写真は同じ経路（API）で消す
{
  const uploadAs = async (cookie, label, albumId) => {
    const bytes = Buffer.from(`assign-${label}-0123456789`);
    const signed = await api("/api/photos/upload-url", {
      method: "POST",
      cookie,
      body: { contentType: "image/png", mediaType: "IMAGE", sizeBytes: bytes.length },
    });
    await fetch(signed.json.upload.url, {
      method: "PUT",
      headers: { "content-type": "image/png", "content-length": String(bytes.length) },
      body: bytes,
    });
    const made = await api("/api/photos", {
      method: "POST",
      cookie,
      body: { contentType: "image/png", mediaUrl: signed.json.publicUrl, sizeBytes: bytes.length, gameTitle: `振り分け確認${label}`, ...(albumId ? { albumId } : {}) },
    });
    return made.json?.photo?.id;
  };
  const assign = (cookie, photoIds, albumId) =>
    api("/api/photos/assign-album", { method: "POST", cookie, body: { photoIds, albumId } });
  const albumOf = async (id) => (await db.photo.findUnique({ where: { id }, select: { albumId: true } }))?.albumId ?? null;

  const made = [];
  // **振り分け先も、最初から入っている先も、ここで作ったアルバムを使う。** 以前は seed のアルバムを
  // `orderBy` なしの findFirst で選んでいて、「あつまれ どうぶつの森」に当たった回だけ投稿で更新時刻が進み、
  // ブラウザスイートの B27（seed の3件の更新順）が落ちていた（2026-10-21、デザイン刷新の段階4の通しで1回だけ出た）
  const madeAlbums = [];
  try {
    for (const title of ["振り分け確認の振り分け先", "振り分け確認の別アルバム"]) {
      const res = await api("/api/albums", { method: "POST", cookie: adminCookie, body: { title, groupId: group.id } });
      madeAlbums.push(res.json?.album?.id ?? null);
    }
    if (madeAlbums.some((id) => !id)) throw new Error(`アルバムを作れなかった: ${JSON.stringify(madeAlbums)}`);
    const target = { id: madeAlbums[0] };
    const other = { id: madeAlbums[1] };
    const loose1 = await uploadAs(memberCookie, "A");
    const loose2 = await uploadAs(memberCookie, "B");
    const placed = other ? await uploadAs(memberCookie, "C", other.id) : null;
    made.push(loose1, loose2, placed);

    const listed = await api("/admin/media?album=none", { cookie: adminCookie });
    const byOutsider = await assign(outsiderCookie, [loose1], target.id);
    const byAdmin = await assign(adminCookie, [loose1, loose2, ...(placed ? [placed] : [])], target.id);

    check(
      "F277 管理者は他の人の未分類をまとめて振り分けられる（未分類のみの一覧に出る・既にアルバムにある投稿は動かない・他の人は動かせない）",
      listed.status === 200 &&
        listed.text.includes("振り分け確認A") &&
        !listed.text.includes("振り分け確認C") &&
        (byOutsider.status === 403 || byOutsider.json?.movedCount === 0) &&
        byAdmin.json?.movedCount === 2 &&
        (await albumOf(loose1)) === target.id &&
        (await albumOf(loose2)) === target.id &&
        (!placed || (await albumOf(placed)) === other.id),
      JSON.stringify({
        listed: listed.status,
        listedA: listed.text.includes("振り分け確認A"),
        listedC: listed.text.includes("振り分け確認C"),
        byOutsider: [byOutsider.status, byOutsider.json?.movedCount],
        byAdmin: byAdmin.json,
        placedStays: placed ? (await albumOf(placed)) === other.id : "投稿できず未確認",
      })
    );

    // 管理者でなければ、他の人の未分類は（自分が編集できるアルバムでも）動かせない
    const loose3 = await uploadAs(adminCookie, "D");
    made.push(loose3);
    const byMember = await assign(memberCookie, [loose3], target.id);
    check(
      "F278 管理者以外は他の人の未分類を振り分けられない（自分の投稿だけ）",
      (byMember.status === 403 || byMember.json?.movedCount === 0) && (await albumOf(loose3)) === null,
      JSON.stringify({ byMember: [byMember.status, byMember.json], albumId: await albumOf(loose3) })
    );
  } catch (e) {
    check("F277x 未分類の振り分けの確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    for (const id of made.filter(Boolean)) await api(`/api/photos/${id}`, { method: "DELETE", cookie: adminCookie });
    for (const id of madeAlbums.filter(Boolean)) await api(`/api/albums/${id}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── 許可リストから外された人は、ログインしたままでも締め出される（2026-10-15 脆弱性チェック） ──
// 見直しは1時間ごと（lib/auth.ts の jwt）。ここでは「最後に見直したのが2時間前」のトークンを作って確かめる
{
  const tokenCookie = async (token) =>
    `next-auth.session-token=${await encode({ token, secret: SECRET, maxAge: 3600 })}`;
  const old = Date.now() - 2 * 60 * 60 * 1000;
  let tempId = null;
  try {
    const temp = await db.user.create({
      data: { email: `removed-${Date.now()}@example.com`, name: "外された人", provider: "discord", discordUserId: "197000000000000001" },
    });
    tempId = temp.id;
    const admin = await db.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } });
    const removed = await tokenCookie({ email: temp.email, sub: temp.email, userId: temp.id, allowCheckedAt: old });
    const stillAllowed = await tokenCookie({ email: "admin@example.com", sub: "admin@example.com", userId: admin.id, allowCheckedAt: old });
    const marked = await tokenCookie({ email: temp.email, sub: temp.email, userId: temp.id, allowCheckedAt: Date.now(), revoked: true });

    const meRemoved = await api("/api/users/me", { cookie: removed });
    const meAllowed = await api("/api/users/me", { cookie: stillAllowed });
    const pageMarked = await api("/", { cookie: marked });
    check(
      "F283 許可リストから外された人は見直しの時点で API が401になり、締め出しの印が付いたら画面もログインへ戻される（載っている人は通る）",
      meRemoved.status === 401 &&
        meAllowed.status === 200 &&
        pageMarked.status >= 300 &&
        pageMarked.status < 400 &&
        /signin|login/.test(pageMarked.headers.get("location") ?? ""),
      JSON.stringify({ meRemoved: meRemoved.status, meAllowed: meAllowed.status, page: [pageMarked.status, pageMarked.headers.get("location")] })
    );
  } catch (e) {
    check("F283x 締め出しの確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    if (tempId) await db.user.deleteMany({ where: { id: tempId } });
  }
}

// ── セキュリティヘッダー（ページ・API・ログイン画面・リダイレクトの全部に付く） ──
{
  const targets = [
    ["ページ", await api(`/groups/${group.id}`, { cookie: adminCookie })],
    ["API", await api("/api/users/me", { cookie: adminCookie })],
    ["ログイン画面", await api("/login")],
    ["未ログインのリダイレクト", await api("/")],
  ];
  const want = {
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  const missing = targets.flatMap(([name, r]) =>
    Object.entries(want)
      .filter(([k, v]) => r.headers.get(k) !== v)
      .map(([k]) => `${name}(${r.status}): ${k}=${r.headers.get(k)}`)
  );
  check(
    "F289 どの応答にも iframe 埋め込み禁止・nosniff・Referer を絞るヘッダーが付く",
    missing.length === 0,
    missing.join(" / ")
  );
}

// ── ログインの失敗の理由を /admin/errors に残す ──
// 画面には `?error=OAuthCallback` という分類しか出ず、中身（確認用の Cookie が無い等）は
// サーバーのログにしか無い。Mac でだけログインできない報告で、手元から理由が分からなかった（2026-10-15）
{
  const FP = "auth:OAUTH_CALLBACK_ERROR:state-missing";
  await db.errorReport.deleteMany({ where: { fingerprint: FP } });
  const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  // Discord から戻ってきたが、ログインを始めたときの Cookie が無い（別のブラウザで戻った・期限切れ等と同じ状態）
  const hit = () =>
    api("/api/auth/callback/discord?code=dummy-code&state=dummy-state", { headers: { "user-agent": MAC_SAFARI } });
  const first = await hit();
  const second = await hit();
  const reports = await db.errorReport.findMany({ where: { fingerprint: FP } });
  const r = reports[0];
  check(
    "F290 Discord から戻ったときの失敗は、理由（Cookieが無い）と端末（Mac / Safari）が /admin/errors に1行で残り、画面は OAuthCallback に戻る",
    /error=OAuthCallback/.test(first.headers.get("location") ?? "") &&
      reports.length === 1 && r.count === 2 &&
      r.message.includes("確認用のCookie（state）が見つからない") && r.message.includes("Mac / Safari") &&
      !r.message.includes("AppleWebKit"),
    `location=${first.headers.get("location")} / ${second.status} / 行=${reports.length} count=${r?.count} / ${r?.message}`
  );
  await db.errorReport.deleteMany({ where: { fingerprint: FP } });
}

// ── Discord が戻り先のURLに `iss` を付けてもログインが落ちない ──
// 2026-10-15、Mac の Chrome だけログインが2回続けて失敗した。/admin/errors に残った理由は
// 「issuer must be configured on the issuer」。Discord が戻り先に `iss`（RFC 9207）を付けるようになり、
// 発行元を設定していない NextAuth の Discord 設定では照合の段階で落ちていた。
// 本物のログインの手順（CSRF → ログイン開始で state と PKCE の Cookie を受け取る → その state で戻る）を通す。
// 戻った後はトークンの交換で Discord に繋ぎに行くので、そこから先は失敗してよい（見るのは iss の照合を越えるか）
{
  await db.errorReport.deleteMany({ where: { fingerprint: { startsWith: "auth:" } } });
  const cookieJar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookieHeader = () => [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ");
  let detail = "";
  let ok = false;
  try {
    const csrf = await fetch(`${BASE}/api/auth/csrf`);
    keep(csrf);
    const { csrfToken } = await csrf.json();
    const start = await fetch(`${BASE}/api/auth/signin/discord`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/` }),
    });
    keep(start);
    const authorizeUrl = new URL(start.headers.get("location") ?? "http://invalid/");
    const state = authorizeUrl.searchParams.get("state");
    const back = await fetch(
      `${BASE}/api/auth/callback/discord?code=dummy-code&state=${encodeURIComponent(state ?? "")}&iss=${encodeURIComponent("https://discord.com")}`,
      { redirect: "manual", headers: { cookie: cookieHeader() } }
    );
    const reports = await db.errorReport.findMany({ where: { fingerprint: { startsWith: "auth:" } } });
    const text = reports.map((r) => r.message).join(" | ");
    ok =
      authorizeUrl.hostname === "discord.com" && !!state &&
      reports.length > 0 && !/state|PKCE/.test(reports.map((r) => r.fingerprint).join(" ")) &&
      !/issuer must be configured|iss mismatch/.test(text);
    detail = `開始=${start.status} ${authorizeUrl.hostname} state=${!!state} / 戻り=${back.status} / 記録=${text}`;
  } catch (e) {
    detail = `途中で例外: ${e?.message ?? e}`;
  }
  check("F292 Discord が戻り先に iss を付けても、発行元の照合で落ちない（Mac で起きたログイン失敗）", ok, detail);
  await db.errorReport.deleteMany({ where: { fingerprint: { startsWith: "auth:" } } });
}

// ── 管理者がプレイ記録を直す（時間の修正・削除・記録されなかった回の手動追加） ──
// Bot が落ちていた・VC に入らずに遊んだ等で欠けた記録を、管理者が後から直す（2026-10-17 ユーザー判断）。
// 画面は /admin/play-log、処理は lib/playLogAdmin.ts
{
  const fs = await import("node:fs");
  const DISCORD_LOG = "/tmp/stub-discord.log";
  const posts = () =>
    (fs.existsSync(DISCORD_LOG) ? fs.readFileSync(DISCORD_LOG, "utf8").split("\n").filter(Boolean) : []).map(
      (l) => JSON.parse(JSON.parse(l).body ?? "{}").content ?? ""
    );
  const internal = { "x-internal-secret": INTERNAL_SECRET };
  const admin = await db.user.findFirst({ where: { email: "admin@example.com" } });
  const member = await db.user.findFirst({ where: { email: "member@example.com" } });
  const outsider = await db.user.findFirst({ where: { email: "outsider@example.com" } });
  const game = await db.groupGame.findFirst({ where: { groupId: group.id }, orderBy: { createdAt: "asc" } });
  const otherGroupGame = await db.groupGame.findFirst({ where: { groupId: { not: group.id } } });
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const call = (method, path, body, cookie = adminCookie) => api(path, { method, cookie, body });
  const made = [];
  let openId = null;
  try {
    // 終了の通知の送り先を置いておく。**手で足した回に今さら「遊びました」が飛ばないこと**を見るため
    // （閉じてから10分〜6時間のまだ送っていない行は、次の生存報告で終了の通知が飛ぶ）
    await api(`/api/groups/${group.id}/notifications`, { method: "PATCH", cookie: adminCookie, body: { kind: "PLAY_LOG", channelId: "900000000000000011" } });
    const created = await call("POST", "/api/admin/play-sessions", {
      groupId: group.id,
      groupGameId: game.id,
      startedAt: iso(150),
      endedAt: iso(30),
      participantIds: [admin.id, member.id],
    });
    if (created.json?.id) made.push(created.json.id);
    const row = created.json?.id
      ? await db.groupPlaySession.findUnique({ where: { id: created.json.id }, include: { participants: true } })
      : null;
    const mark = posts().length;
    await api("/api/internal/bot-heartbeat", { method: "POST", headers: internal });
    const ended = posts().slice(mark).filter((c) => c.includes("遊びました"));
    check(
      "F293 管理者は記録されなかったプレイを手で足せる（ゲーム・時間・参加者が入り、今さら終了の通知は飛ばない）",
      created.status === 201 && row?.groupGameId === game.id && row?.participants.length === 2 &&
        row?.gameKey.startsWith("manual:") && row?.endNotifiedAt !== null && ended.length === 0,
      `${created.status} ${created.text.slice(0, 80)} / 参加${row?.participants.length} / 通知=${ended.join(" | ")}`
    );

    // 入力の間違いは理由つきで弾く（どれも保存されない）
    const base = { groupId: group.id, groupGameId: game.id, startedAt: iso(120), endedAt: iso(60), participantIds: [admin.id] };
    const bad = {
      reversed: await call("POST", "/api/admin/play-sessions", { ...base, startedAt: iso(60), endedAt: iso(120) }),
      tooLong: await call("POST", "/api/admin/play-sessions", { ...base, startedAt: iso(60 * 30), endedAt: iso(60) }),
      future: await call("POST", "/api/admin/play-sessions", { ...base, endedAt: new Date(Date.now() + 3600000).toISOString() }),
      outsider: await call("POST", "/api/admin/play-sessions", { ...base, participantIds: [outsider.id] }),
      otherGame: await call("POST", "/api/admin/play-sessions", { ...base, groupGameId: otherGroupGame?.id ?? "none" }),
      noGame: await call("POST", "/api/admin/play-sessions", { ...base, groupGameId: null }),
      nobody: await call("POST", "/api/admin/play-sessions", { ...base, participantIds: [] }),
    };
    const statuses = Object.fromEntries(Object.entries(bad).map(([k, r]) => [k, r.status]));
    for (const r of Object.values(bad)) if (r.json?.id) made.push(r.json.id);
    check(
      "F294 逆転・24時間超え・未来・グループ外の参加者・他グループのゲーム・ゲーム無し・参加者0人は400で、保存されない",
      Object.values(statuses).every((st) => st === 400) && Object.values(bad).every((r) => typeof r.json?.error === "string"),
      JSON.stringify(statuses)
    );

    // 修正：時間を縮め、参加者を1人に。残った人の入った・抜けた時刻も新しい範囲に収まる
    const id = created.json?.id;
    const patched = await call("PATCH", `/api/admin/play-sessions/${id}`, {
      startedAt: iso(140),
      endedAt: iso(80),
      participantIds: [admin.id],
    });
    const after = id ? await db.groupPlaySession.findUnique({ where: { id }, include: { participants: true } }) : null;
    const p0 = after?.participants[0];
    const inRange = !!p0 && p0.joinedAt >= after.startedAt && p0.leftAt !== null && p0.leftAt <= after.endedAt;
    // 進行中の行は Bot がまだ開け閉めしているので、直せない・消せない
    const open = await db.groupPlaySession.create({
      data: { groupId: group.id, gameKey: "name:admin-edit-open", activityName: "進行中のテスト", voiceChannelId: "vc-admin-edit", startedAt: new Date(Date.now() - 600000) },
    });
    openId = open.id;
    const openPatch = await call("PATCH", `/api/admin/play-sessions/${open.id}`, { startedAt: iso(20), endedAt: iso(5), participantIds: [admin.id] });
    const openDelete = await call("DELETE", `/api/admin/play-sessions/${open.id}`);
    check(
      "F295 管理者は時間と参加者を直せる（参加者の時刻も範囲に収まる）。進行中の記録は直せず消せない（409）",
      patched.status === 200 && after?.participants.length === 1 && Math.abs(after.endedAt.getTime() - Date.parse(iso(80))) < 120000 &&
        inRange && openPatch.status === 409 && openDelete.status === 409,
      `修正=${patched.status} ${patched.text.slice(0, 60)} / 参加${after?.participants.length} 範囲内=${inRange} / 進行中=${openPatch.status},${openDelete.status}`
    );

    // 削除：行も参加者も消える。2回目は404
    const del = await call("DELETE", `/api/admin/play-sessions/${id}`);
    const gone = id ? await db.groupPlaySession.count({ where: { id } }) : -1;
    const goneP = id ? await db.groupPlayParticipant.count({ where: { sessionId: id } }) : -1;
    const again = await call("DELETE", `/api/admin/play-sessions/${id}`);
    if (del.status === 200) made.splice(made.indexOf(id), 1);
    // 管理者以外は触れない
    const byMember = await call("POST", "/api/admin/play-sessions", base, memberCookie);
    const byMemberDel = await call("DELETE", `/api/admin/play-sessions/${open.id}`, undefined, memberCookie);
    check(
      "F296 管理者は記録を消せる（参加者ごと消え、2回目は404）。管理者以外は追加も削除もできない（403）",
      del.status === 200 && gone === 0 && goneP === 0 && again.status === 404 && byMember.status === 403 && byMemberDel.status === 403,
      `削除=${del.status} 残り=${gone}/${goneP} 再=${again.status} / メンバー=${byMember.status},${byMemberDel.status}`
    );
  } catch (e) {
    check("F293x プレイ記録の管理の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    for (const id of made) await call("DELETE", `/api/admin/play-sessions/${id}`);
    if (openId) await db.groupPlaySession.deleteMany({ where: { id: openId } });
    await api(`/api/groups/${group.id}/notifications`, { method: "PATCH", cookie: adminCookie, body: { kind: "PLAY_LOG", channelId: "" } });
  }
}

// ── グループ画面の帯（合計）とゲーム一覧の時間（docs/play-log.md §13） ──
// 数え方の中身は lib-checks の F298。ここは画面に正しく出るか：帯の合計が増えた分だけ増える・ゲーム一覧の時間が
// ゲーム詳細の合計と一致する・ゲームに結びついていない記録は入らない・記録の無いグループには帯が出ない
{
  // 一覧は既定で「プレイ中」「プレイ予定」だけを出すので、そのどちらかのゲームを使う
  const game = await db.groupGame.findFirst({ where: { groupId: group.id, status: { in: ["PLAYING", "WISHLIST"] } }, orderBy: { createdAt: "asc" } });
  const bannerMs = (html) => Number(html.match(/data-testid="play-total-banner"[^>]*data-play-ms="(\d+)"/)?.[1] ?? 0);
  // 同じゲーム詳細へのリンクは帯（いちばん遊んだゲーム）や「プレイ中」の集計にもある。
  // 一覧のカードだけが持つ「〇〇が追加」の入ったリンクを探す
  const listMs = (html, gameId) => {
    const href = `/groups/${group.id}/games/${gameId}"`;
    for (let at = html.indexOf(href); at >= 0; at = html.indexOf(href, at + 1)) {
      const chunk = html.slice(at, html.indexOf("</a>", at));
      if (chunk.includes("が追加")) return Number(chunk.match(/data-play-ms="(\d+)"/)?.[1] ?? 0);
    }
    return null;
  };
  const made = [];
  try {
    const before = await api(`/groups/${group.id}`, { cookie: adminCookie });
    const base = Date.now() - 5 * 86400000;
    const mk = (groupGameId, fromMin, toMin, key) =>
      db.groupPlaySession.create({
        data: { groupId: group.id, groupGameId, gameKey: key, activityName: key, voiceChannelId: "vc-banner", startedAt: new Date(base + fromMin * 60000), endedAt: new Date(base + toMin * 60000) },
      }).then((r) => made.push(r.id));
    await mk(game.id, 0, 75, "name:banner-a"); // 75分
    await mk(null, 100, 160, "name:banner-unknown"); // 結びついていない60分（入らない）
    const after = await api(`/groups/${group.id}`, { cookie: adminCookie });
    const detail = await api(`/groups/${group.id}/games/${game.id}`, { cookie: adminCookie });
    const detailMs = Number(detail.text.match(/data-testid="group-play-total"[^>]*data-play-ms="(\d+)"/)?.[1] ?? -1);
    // 記録の無いグループ（作ったばかり）には帯が出ない
    const fresh = await api("/api/groups", { method: "POST", cookie: adminCookie, body: { name: `帯なし確認-${randomUUID().slice(0, 6)}` } });
    const freshId = fresh.json?.group?.id;
    const freshPage = freshId ? await api(`/groups/${freshId}`, { cookie: adminCookie }) : null;
    if (freshId) await api(`/groups/${freshId}`, { method: "DELETE", cookie: adminCookie });
    const delta = bannerMs(after.text) - bannerMs(before.text);
    const list = listMs(after.text, game.id);
    check(
      "F297 グループ画面の帯の合計とゲーム一覧の時間が出て、ゲーム詳細の合計と一致する（結びついていない記録は入らず、記録の無いグループに帯は出ない）",
      after.status === 200 && delta === 75 * 60000 && list !== null && list === detailMs && list > 0 &&
        after.text.includes("グループで遊んだ時間") && freshPage?.status === 200 && !freshPage.text.includes('data-testid="play-total-banner"'),
      `増分=${delta / 60000}分 / 一覧=${list} 詳細=${detailMs} / 新規グループに帯=${freshPage?.text.includes('data-testid="play-total-banner"')}`
    );
  } catch (e) {
    check("F297x グループ画面のプレイ時間の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // プレイ記録はキャッシュに載せていないのでDBから直接消してよい
    await db.groupPlaySession.deleteMany({ where: { id: { in: made } } });
  }
}

// ── 活動カレンダーのプレイ記録（docs/play-log.md §11 の段階1） ──
// 数え方の中身は lib-checks の F299。ここは /admin/activity に出るか：日のマスの🎮・その日の合計・タイムラインの1行。
// 管理者以外には出ない（ページごと404）
{
  const game = await db.groupGame.findFirst({ where: { groupId: group.id }, orderBy: { createdAt: "asc" } });
  // 他のテストが記録を置かない日（23日前の21:00〜22:30 JST）
  const day = new Date(Date.now() + 9 * 3600000 - 23 * 86400000).toISOString().slice(0, 10);
  const start = new Date(`${day}T21:00:00.000+09:00`);
  const month = day.slice(0, 7);
  const page = (date, cookie = adminCookie) =>
    api(`/admin/activity?group=${group.id}&month=${month}${date ? `&date=${date}` : ""}`, { cookie });
  const dayTotal = (html) => Number(html.match(/data-testid="day-play-total"[^>]*data-play-ms="(\d+)"/)?.[1] ?? 0);
  // マスは日付つきのリンク。その中の data-play-ms を読む（URLの & は HTML では &amp; になる）
  const cellMs = (html) => {
    const at = html.indexOf(`date=${day}"`);
    if (at < 0) return null;
    return Number(html.slice(at, html.indexOf("</a>", at)).match(/data-play-ms="(\d+)"/)?.[1] ?? 0);
  };
  let made = null;
  try {
    const before = await page(day);
    made = await db.groupPlaySession.create({
      data: {
        groupId: group.id, groupGameId: game.id, gameKey: "name:calendar-flow", activityName: "calendar-flow", voiceChannelId: "vc-calendar",
        startedAt: start, endedAt: new Date(start.getTime() + 90 * 60000),
      },
    });
    const after = await page(day);
    const monthView = await page(null);
    const byMember = await page(day, memberCookie);
    const gameHref = `/groups/${group.id}/games/${game.id}`;
    const delta = dayTotal(after.text) - dayTotal(before.text);
    check(
      "F300 活動カレンダーにプレイ記録が載る（日のマスに遊んだアイコン・その日の合計・タイムラインに1回1行でゲームへのリンク）。管理者以外には出ない",
      after.status === 200 && delta === 90 * 60000 && (cellMs(monthView.text) ?? 0) >= 90 * 60000 &&
        after.text.includes(" を 1時間30分") && after.text.includes(gameHref) && monthView.text.includes('data-kind="play.session"') &&
        !byMember.text.includes("day-play-total") && !byMember.text.includes("この月の記録"),
      `合計の増分=${delta / 60000}分 / マス=${cellMs(monthView.text)} / 行=${after.text.includes(" を 1時間30分")} / 管理者以外に出る=${byMember.text.includes("day-play-total")}`
    );
  } catch (e) {
    check("F300x 活動カレンダーのプレイ記録の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // プレイ記録はキャッシュに載せていないのでDBから直接消してよい
    if (made) await db.groupPlaySession.delete({ where: { id: made.id } }).catch(() => {});
  }
}

// ── グループ画面の「最近の動き」とグループの活動カレンダー（docs/play-log.md §11 の段階2） ──
// 中身の組み立ては lib-checks の F301。ここは画面：グループ画面に欄とカレンダーへのリンクが出る・
// メンバーが専用ページを開ける・取り消し系（写真の削除）は管理画面には出てもグループ向けには出ない。
// 他のグループの人・未ログインの人に中身が出ないことは sweep の P14b・P14c
{
  const admin = await db.user.findUnique({ where: { email: "admin@example.com" } });
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const made = [];
  try {
    const mk = (kind, targetId) =>
      db.activityLog.create({ data: { kind, targetId, groupId: group.id, actorId: admin.id, occurredAt: new Date() } }).then((r) => made.push(r.id));
    await mk("photo.created", "recent-flow-new");
    await mk("photo.deleted", "recent-flow-del");
    const groupPage = await api(`/groups/${group.id}`, { cookie: memberCookie });
    const at = groupPage.text.indexOf('data-testid="recent-activity"');
    const section = at >= 0 ? groupPage.text.slice(at, groupPage.text.indexOf("</section>", at)) : "";
    const q = `month=${today.slice(0, 7)}&date=${today}`;
    const memberPage = await api(`/groups/${group.id}/activity?${q}`, { cookie: memberCookie });
    const adminPage = await api(`/admin/activity?group=${group.id}&${q}`, { cookie: adminCookie });
    check(
      "F302 グループ画面に「最近の動き」とカレンダーへのリンクが出て、メンバーが活動カレンダーを開ける。写真の削除は管理画面には出てもグループ向けには出ない",
      groupPage.status === 200 && section.includes("最近の動き") && section.includes(`/groups/${group.id}/activity"`) && section.includes("写真を") &&
        !section.includes("写真を削除") &&
        memberPage.status === 200 && memberPage.text.includes("この月の記録") && memberPage.text.includes("写真を投稿") &&
        !memberPage.text.includes("写真を削除") && !memberPage.text.includes("🗑️") &&
        adminPage.text.includes("写真を削除"),
      `欄=${section.includes("最近の動き")} / リンク=${section.includes(`/groups/${group.id}/activity"`)} / 欄に削除=${section.includes("写真を削除")} / ` +
        `専用ページ=${memberPage.status}・中身=${memberPage.text.includes("この月の記録")}・削除=${memberPage.text.includes("写真を削除")} / 管理画面に削除=${adminPage.text.includes("写真を削除")}`
    );
  } catch (e) {
    check("F302x 最近の動きの確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // 出来事の記録はキャッシュに載せていない（グループ画面の「最近の動き」も毎回読む）のでDBから直接消してよい
    await db.activityLog.deleteMany({ where: { id: { in: made } } });
  }
}

// ── ホームの「みんなの動き」と、最近の動きからステータスの変更を外す（2026-10-21 ユーザー判断） ──
// - ホームには自分の所属するグループの動きだけが出て、グループ名が添えられる（他人のグループの出来事は出ない）
// - 「みんなの動き」は「最近の投稿」より上
// - ステータスの変更は、グループ画面の「最近の動き」とホームには出ず、活動カレンダーには今までどおり出る
{
  const otherGroup = await db.group.findFirst({ where: { name: "部外者のグループ" } });
  const made = [];
  try {
    const now = new Date();
    const mk = async (groupId, kind, targetName) =>
      made.push((await db.activityLog.create({ data: { kind, targetId: randomUUID(), targetName, groupId, actorId: null, occurredAt: now, createdAt: now } })).id);
    await mk(group.id, "album.created", "みんなの動きの確認アルバム");
    await mk(group.id, "game.status_changed", "ステータスだけ変えたゲーム");
    await mk(otherGroup.id, "album.created", "部外者だけの出来事");
    const [adminHome, outsiderHome, groupPage] = await Promise.all([
      api("/", { cookie: adminCookie }),
      api("/", { cookie: outsiderCookie }),
      api(`/groups/${group.id}`, { cookie: adminCookie }),
    ]);
    const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    const calendar = await api(`/groups/${group.id}/activity?month=${today.slice(0, 7)}&date=${today}`, { cookie: adminCookie });
    const homeSection = (html) => {
      const at = html.indexOf('data-testid="home-activity"');
      return at >= 0 ? html.slice(at, html.indexOf("</section>", at)) : "";
    };
    const a = homeSection(adminHome.text);
    const o = homeSection(outsiderHome.text);
    // 見出しのタグで比べる。素の「最近の投稿」は、HTMLの前半にある Next.js の埋め込みデータ（RSC）に先に出てくる
    const activityBeforePhotos = adminHome.text.indexOf('data-testid="home-activity"') < adminHome.text.indexOf(">最近の投稿</h2>");
    check(
      "F311 ホームに所属グループの「みんなの動き」がグループ名つきで「最近の投稿」より上に出て、他人のグループの出来事は出ない。ステータスの変更は最近の動きとホームに出ず、活動カレンダーには出る",
      adminHome.status === 200 && a.includes("みんなの動き") && a.includes("みんなの動きの確認アルバム") && a.includes(group.name) &&
        !a.includes("部外者だけの出来事") && activityBeforePhotos &&
        o.includes("部外者だけの出来事") && !o.includes("みんなの動きの確認アルバム") &&
        !a.includes("ステータスだけ変えたゲーム") && !groupPage.text.includes("ステータスだけ変えたゲーム") &&
        calendar.text.includes("ステータスだけ変えたゲーム"),
      `ホーム(管理者)=${!!a}・自分のグループ=${a.includes("みんなの動きの確認アルバム")}・グループ名=${a.includes(group.name)}・他人=${a.includes("部外者だけの出来事")}・投稿より上=${activityBeforePhotos} / ` +
        `ホーム(部外者)=${o.includes("部外者だけの出来事")}・他人=${o.includes("みんなの動きの確認アルバム")} / ステータス変更: ホーム=${a.includes("ステータスだけ変えたゲーム")}・グループ画面=${groupPage.text.includes("ステータスだけ変えたゲーム")}・カレンダー=${calendar.text.includes("ステータスだけ変えたゲーム")}`
    );
  } catch (e) {
    check("F311x みんなの動きの確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // 出来事の記録はキャッシュに載せていない（ホームとグループ画面も毎回読む）のでDBから直接消してよい
    await db.activityLog.deleteMany({ where: { id: { in: made } } });
  }
}

// ── 使い方の説明ページ（2026-10-19 に載っていなかった機能を足した） ──
// 中身はタップで開くまで描かれないので、項目の見出しで見る。管理者向けの項目は管理者にだけ出る
{
  const byAdmin = await api("/manual", { cookie: adminCookie });
  const byMember = await api("/manual", { cookie: memberCookie });
  check(
    "F304 説明ページに「グループの活動」の項目があり、「管理者向けの機能」は管理者にだけ出る",
    byAdmin.status === 200 && byMember.status === 200 &&
      byAdmin.text.includes("グループの活動（最近の動き・活動カレンダー）") && byMember.text.includes("グループの活動（最近の動き・活動カレンダー）") &&
      byAdmin.text.includes("管理者向けの機能") && !byMember.text.includes("管理者向けの機能"),
    `管理者: 活動=${byAdmin.text.includes("グループの活動")}・管理=${byAdmin.text.includes("管理者向けの機能")} / メンバー: 活動=${byMember.text.includes("グループの活動")}・管理=${byMember.text.includes("管理者向けの機能")}`
  );
}

// ── favicon（2026-10-21 に M1 へ差し替え。経緯は docs/design/favicon.md） ──
// ページの head にタブ用（SVG）とホーム画面用（apple-touch-icon）のリンクが出て、どちらも画像として返る。
// SVG を読まないブラウザ用の /favicon.ico も返る。以前の紫の icon.png のリンクは出ない
{
  const page = await api("/login");
  const svgHref = page.text.match(/<link rel="icon" href="([^"]+)" type="image\/svg\+xml"/)?.[1] ?? null;
  const appleHref = page.text.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1] ?? null;
  const fetchType = async (href) => {
    if (!href) return null;
    const res = await fetch(BASE + href);
    return `${res.status} ${res.headers.get("content-type")}`;
  };
  const [svgType, appleType, icoType] = await Promise.all([fetchType(svgHref), fetchType(appleHref), fetchType("/favicon.ico")]);
  check(
    "F315 favicon：タブ用の SVG とホーム画面用の画像のリンクが出て、どちらも画像が返り、/favicon.ico もある（以前の icon.png は出ない）",
    !!svgHref && svgType?.startsWith("200 image/svg+xml") && appleType?.startsWith("200 image/png") &&
      icoType?.startsWith("200 image/") && !page.text.includes('href="/icon.png'),
    `SVG=${svgHref}（${svgType}） / ホーム画面=${appleHref}（${appleType}） / ico=${icoType} / 古いicon.png=${page.text.includes('href="/icon.png')}`
  );
}

// ── グループの見出しの顔：Discord のアイコンがある人は画像、無い人は頭文字（2026-10-21 ユーザー判断） ──
// 新しく作ったグループで見る（グループの中身はキャッシュに載るので、既存のグループで見ると前の描画が返りうる）。
// 管理者のアイコンは確認の間だけ入れて、すぐ元に戻す（ほかのページのキャッシュに残さないため、描画は1回だけ）
{
  const adminUser = await db.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true, avatarUrl: true } });
  const memberUser = await db.user.findUnique({ where: { email: "member@example.com" }, select: { id: true, avatarUrl: true } });
  let faceGroupId = null;
  try {
    await db.user.update({ where: { id: adminUser.id }, data: { avatarUrl: "https://cdn.discordapp.com/avatars/1/face-check.png" } });
    await db.user.update({ where: { id: memberUser.id }, data: { avatarUrl: null } });
    const made = await api("/api/groups", { method: "POST", cookie: adminCookie, body: { name: `顔の確認-${Date.now()}` } });
    faceGroupId = made.json?.group?.id ?? null;
    await api(`/api/groups/${faceGroupId}/members`, { method: "POST", cookie: adminCookie, body: { email: "member@example.com", role: "VIEWER" } });
    const page = await api(`/groups/${faceGroupId}`, { cookie: adminCookie });
    const faces = [...page.text.matchAll(/data-face="(avatar|initial)"/g)].map((m) => m[1]);
    const avatarImg = /data-face="avatar"[^>]*>\s*<img[^>]+src="[^"]*cdn\.discordapp\.com[^"]*face-check\.png/.test(page.text);
    check(
      "F313 グループの見出しに、Discord のアイコンがある人は画像、無い人は頭文字の丸で並ぶ",
      page.status === 200 && faces.length === 2 && faces.includes("avatar") && faces.includes("initial") && avatarImg,
      `顔=${faces.join(",")} / アイコンの画像=${avatarImg}`
    );
  } catch (e) {
    check("F313x グループの見出しの顔の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    await db.user.update({ where: { id: adminUser.id }, data: { avatarUrl: adminUser.avatarUrl } });
    await db.user.update({ where: { id: memberUser.id }, data: { avatarUrl: memberUser.avatarUrl } });
    if (faceGroupId) await api(`/api/groups/${faceGroupId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── マニュアルを分類ごとに並べる（2026-10-21 ユーザー判断。トピックが22まで増えた） ──
// 目次（分類と件数）・分類の見出しが並ぶ順・どのトピックがどの分類か（代表を見る）・管理者向けは管理者にだけ
{
  const byAdmin = await api("/manual", { cookie: adminCookie });
  const byMember = await api("/manual", { cookie: memberCookie });
  const headings = (html) => [...html.matchAll(/data-testid="manual-category"[^>]*><h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  const sectionOf = (html, label) => {
    const at = html.indexOf(`>${label}</h2>`);
    const next = html.indexOf('data-testid="manual-category"', at);
    return at >= 0 ? html.slice(at, next >= 0 ? next : undefined) : "";
  };
  const a = headings(byAdmin.text);
  const m = headings(byMember.text);
  const placed =
    sectionOf(byAdmin.text, "はじめに").includes("友達をグループに招待する") &&
    sectionOf(byAdmin.text, "写真・アルバム").includes("手動アップロード") &&
    sectionOf(byAdmin.text, "Discord").includes("ハッシュタグで自動取り込みする") &&
    sectionOf(byAdmin.text, "ゲーム・遊んだ記録").includes("グループで遊んだ時間（プレイ記録）") &&
    sectionOf(byAdmin.text, "管理者向け").includes("管理者向けの機能");
  // 分類の中は読む順（書いた順ではない）。「はじめに」はメニューの使い方から、「写真・アルバム」は手動アップロードから
  const firstOf = (label) => sectionOf(byAdmin.text, label).match(/font-semibold text-steam-text">([^<]+)</)?.[1] ?? "";
  const ordered = firstOf("はじめに") === "メニューの使い方（スマホとパソコン）" && firstOf("写真・アルバム") === "手動アップロード";
  check(
    "F314 マニュアルが分類（はじめに・写真・アルバム・Discord・ゲーム・遊んだ記録・管理者向け）ごとに並び、分類の中は読む順で、目次に件数が出て、管理者向けは管理者にだけ出る",
    byAdmin.status === 200 && byMember.status === 200 &&
      a.join("|") === "はじめに|写真・アルバム|Discord|ゲーム・遊んだ記録|管理者向け" &&
      m.join("|") === "はじめに|写真・アルバム|Discord|ゲーム・遊んだ記録" &&
      byAdmin.text.includes('href="#category-photos"') && byAdmin.text.includes("写真・アルバム（6）") && placed && ordered,
    `管理者=${a.join("|")} / メンバー=${m.join("|")} / 目次=${byAdmin.text.includes("写真・アルバム（6）")} / 置き場所=${placed} / 先頭=${firstOf("はじめに")}・${firstOf("写真・アルバム")}`
  );
}

// ── ウィッシュリストの価格（Steamの今の値段とSteamでの過去最安値） ──
// 外部は fetch-stub。Steamの最安値は ITAD の stub が全ゲーム ¥4,730 を返す。
// - ELDEN RING（1245620）: 今 ¥4,730（-45%）＝最安値と同じなので「最安値」の印が付く
// - Dota 2（570）: 無料。印は付かない
// - stub が知らないゲーム（9100099）: Steamの値段は取れず、最安値だけ返る
// seed の提案は前の確認でリアクションを受けて決着しうるので使わず、自分でグループと提案を作る
{
  const made = await api("/api/groups", {
    method: "POST",
    cookie: adminCookie,
    body: { name: `価格テスト用グループ-${randomUUID().slice(0, 8)}` },
  });
  const priceGroupId = made.json?.group?.id ?? null;
  try {
    for (const [steamAppId, title] of [[1245620, "ELDEN RING"], [570, "Dota 2"], [9100099, "値段の無いゲーム"]]) {
      await api(`/api/groups/${priceGroupId}/proposals`, { method: "POST", cookie: adminCookie, body: { steamAppId, title } });
    }
    const res = await api(`/api/groups/${priceGroupId}/proposals/prices`, { cookie: adminCookie });
    const prices = res.json?.prices ?? {};
    const sale = prices["1245620"];
    const free = prices["570"];
    const lowOnly = prices["9100099"];
    check(
      "F306 ウィッシュリストの価格APIが、提案のゲームごとにSteamの今の値段・割引率・Steamでの最安値・「最安値」の印を返す（無料・値段なしも）",
      !!priceGroupId && res.status === 200 &&
        sale?.price === 4730 && sale?.discountPercent === 45 && sale?.steamLow === 4730 && sale?.atLow === true &&
        free?.isFree === true && free?.price === 0 && free?.atLow === false &&
        lowOnly?.price === null && lowOnly?.steamLow === 4730 && lowOnly?.atLow === false,
      `group=${!!priceGroupId} status=${res.status} ${JSON.stringify(prices)}`
    );
  } catch (e) {
    check("F306x ウィッシュリストの価格の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    if (priceGroupId) await api(`/api/groups/${priceGroupId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ───────────────────────────────────────────────────────────
// テストの棚卸し（2026-10-11）で見つかった抜け
// ───────────────────────────────────────────────────────────
//
// 一度も叩いていなかったAPIの「成功する側」と、招待で過去に踏んだ落とし穴の再現。
// 権限の「弾く側」は api-sweep（R40〜R55）にある。どれも作ったものは同じ経路で戻す。

// ── HTTPからは届かない処理（ログインの途中で動く招待の消費・管理者の判定） ──
// tsx で Web のライブラリを直接呼ぶ。中身は lib-checks.mts
{
  try {
    const out = execFileSync(
      join(ROOT, "node_modules/.bin/tsx"),
      ["--tsconfig", "apps/web/tsconfig.json", "tools/local-test/lib-checks.mts"],
      { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 120000 }
    );
    const rows = JSON.parse(out.trim().split("\n").pop());
    for (const r of rows) check(`${r.id} ${r.item}`, r.ok, r.detail);
  } catch (e) {
    check("F234x ライブラリの直接確認が起動できなかった（以降は未確認）", false, e?.stderr || e?.stack || e);
  }
}

// ── アルバムのメンバー管理 ──
{
  const outsiderUser = await db.user.findUnique({ where: { email: "outsider@example.com" } });
  const albumApi = (cookie) => api(`/api/albums/${album.id}`, { cookie });
  let added = null;
  try {
    const before = await albumApi(outsiderCookie);
    added = await api(`/api/albums/${album.id}/members`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: "outsider@example.com", role: "VIEWER" },
    });
    const seen = await albumApi(outsiderCookie);
    check(
      "F239 アルバムのオーナーがメンバーを足すと、その人が見られるようになる",
      before.status === 403 && added.status === 201 && seen.status === 200,
      `${before.status} → 追加${added.status} → ${seen.status}`
    );

    const patched = await api(`/api/albums/${album.id}/members/${outsiderUser.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "EDITOR" },
    });
    const row = await db.albumMember.findUnique({
      where: { albumId_userId: { albumId: album.id, userId: outsiderUser.id } },
    });
    check("F240 アルバムのメンバーの役割を変えられる", patched.status === 200 && row?.role === "EDITOR", `${patched.status} / ${row?.role}`);

    // 役割の値は EDITOR / VIEWER だけ。以前は知らない値で500、"OWNER" はそのまま通っていた
    const owner = await api(`/api/albums/${album.id}/members/${outsiderUser.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "OWNER" },
    });
    const junk = await api(`/api/albums/${album.id}/members`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: "outsider@example.com", role: "ADMIN" },
    });
    const stranger = await api(`/api/albums/${album.id}/members/no-such-user`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "VIEWER" },
    });
    check(
      "F241 アルバムの役割に OWNER や知らない値は渡せず（400）、メンバーでない人は404",
      owner.status === 400 && junk.status === 400 && stranger.status === 404,
      `OWNER=${owner.status} / 知らない値=${junk.status} / 非メンバー=${stranger.status}`
    );

    const removed = await api(`/api/albums/${album.id}/members/${outsiderUser.id}`, { method: "DELETE", cookie: adminCookie });
    const afterApi = await albumApi(outsiderCookie);
    const afterPage = await api(`/albums/${album.id}`, { cookie: outsiderCookie });
    const removedAgain = await api(`/api/albums/${album.id}/members/${outsiderUser.id}`, { method: "DELETE", cookie: adminCookie });
    check(
      "F242 外すとAPIでも画面でも見られなくなり（キャッシュが残らない）、二度目の削除は404",
      removed.status === 200 &&
        afterApi.status === 403 &&
        showsNotFound(afterPage.text) &&
        !afterPage.text.includes("総合テスト用のアルバム") &&
        removedAgain.status === 404,
      `${removed.status} / API=${afterApi.status} / 画面=${showsNotFound(afterPage.text) ? "not-found" : "見えている"} / 再削除=${removedAgain.status}`
    );
  } catch (e) {
    check("F239x アルバムのメンバー管理の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // 途中で落ちても部外者をアルバムに残さない（後ろのスイートの前提が崩れる）
    await api(`/api/albums/${album.id}/members/${outsiderUser.id}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── アルバムのタグ ──
{
  const tagName = `gapcheck${Date.now()}`;
  const addTag = await api(`/api/albums/${album.id}/tags`, {
    method: "POST",
    cookie: adminCookie,
    body: { guildId: group.guildId, tag: tagName },
  });
  const tagId = addTag.json?.tag?.id;
  const listed = await api(`/api/albums/${album.id}/tags`, { cookie: memberCookie });
  const delTag = await api(`/api/albums/${album.id}/tags/${tagId}`, { method: "DELETE", cookie: adminCookie });
  const listedAfter = await api(`/api/albums/${album.id}/tags`, { cookie: memberCookie });
  const has = (r) => (r.json?.tags ?? []).some((t) => t.tag === tagName);
  check(
    "F243 アルバムにタグを足して一覧に出し、消せる（見られるメンバーは一覧を読める）",
    addTag.status === 201 && listed.status === 200 && has(listed) && delTag.status === 200 && !has(listedAfter),
    `追加${addTag.status} / 一覧${listed.status}:${has(listed)} / 削除${delTag.status} / 後:${has(listedAfter)}`
  );
}

// ── 許可リストの削除 ──
{
  const email = `gapcheck-${randomUUID().slice(0, 8)}@example.com`;
  const created = await api("/api/allowlist", { method: "POST", cookie: adminCookie, body: { email } });
  const entryId = created.json?.entry?.id;
  const del = await api(`/api/allowlist/${entryId}`, { method: "DELETE", cookie: adminCookie });
  const gone = entryId ? await db.allowlistEntry.findUnique({ where: { id: entryId } }) : "no-id";
  check("F244 管理者は許可リストから外せる", created.status === 201 && del.status === 200 && gone === null, `${created.status} / ${del.status} / ${gone}`);

  // 自分自身の登録は消せない（消すと次のログインで締め出され、直せる人がいなくなる）
  const self = await db.allowlistEntry.findFirst({ where: { email: "admin@example.com" } });
  const selfDel = self ? await api(`/api/allowlist/${self.id}`, { method: "DELETE", cookie: adminCookie }) : { status: "seedに無い" };
  const selfStill = self ? await db.allowlistEntry.findUnique({ where: { id: self.id } }) : null;
  check("F245 管理者が自分自身の登録を消そうとすると400で、登録は残る", selfDel.status === 400 && !!selfStill, `${selfDel.status} / 残:${!!selfStill}`);
}

// ── Discordのチャンネル対応 ──
{
  const gameTitle = `チャンネル対応テスト-${randomUUID().slice(0, 6)}`;
  // 先にグループ画面を開いてキャッシュを温めておく（作った自動アルバムが出るか＝無効化を見るため）
  await api(`/groups/${group.id}`, { cookie: adminCookie });
  const made = await api("/api/discord/channel-mappings", {
    method: "POST",
    cookie: adminCookie,
    body: { guildId: group.guildId, channelId: "700000000000000123", gameTitle },
  });
  const mappingId = made.json?.mapping?.id;
  const autoAlbumId = made.json?.mapping?.autoAlbumId;
  try {
    const listed = await api("/api/discord/channel-mappings", { cookie: adminCookie });
    const inList = JSON.stringify(listed.json ?? {}).includes(mappingId ?? "-");
    const groupPage = await api(`/groups/${group.id}`, { cookie: adminCookie });
    check(
      "F246 チャンネル対応を作ると一覧に出て、専用の自動アルバムがグループ画面にも出る",
      made.status === 201 && inList && groupPage.text.includes(gameTitle),
      `${made.status} / 一覧:${inList} / グループ画面:${groupPage.text.includes(gameTitle)}`
    );
    const del = await api(`/api/discord/channel-mappings/${mappingId}`, { method: "DELETE", cookie: adminCookie });
    const gone = mappingId ? await db.discordChannelMapping.findUnique({ where: { id: mappingId } }) : "no-id";
    check("F247 チャンネル対応を消せる", del.status === 200 && gone === null, `${del.status} / ${gone}`);
  } finally {
    if (autoAlbumId) await api(`/api/albums/${autoAlbumId}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── Discord連携の確認・Discordのチャンネル一覧・/tag の受け口 ──
{
  const link = await api("/api/discord/link", { cookie: adminCookie });
  check("F248 Discord連携済みの人には linked: true が返る", link.status === 200 && link.json?.linked === true, link.text.slice(0, 80));

  const channels = await api(`/api/groups/${group.id}/discord-channels`, { cookie: adminCookie });
  check(
    "F249 オーナーはグループのDiscordのチャンネル一覧を取れる",
    channels.status === 200 && Array.isArray(channels.json?.channels),
    `${channels.status} ${channels.text.slice(0, 80)}`
  );

  // /tag：直近のDiscordの投稿に、既にあるタグのアルバムを付ける
  const messageId = `tagcheck-${randomUUID()}`;
  const ingest = await api("/api/discord/ingest", {
    method: "POST",
    headers: { "x-internal-secret": INTERNAL_SECRET },
    body: {
      discordUserId: "100000000000000002",
      channelId: "700000000000000001",
      guildId: group.guildId,
      attachmentUrl: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
      contentType: "image/png",
      sizeBytes: 1024,
      discordMessageId: messageId,
      postedAt: new Date().toISOString(),
    },
  });
  const photo = await db.photo.findFirst({ where: { discordMessageId: { startsWith: messageId } } });
  try {
    const existingTag = await db.discordGameTag.findFirst({ where: { guildId: group.guildId }, orderBy: { createdAt: "asc" } });
    const tagged = await api("/api/discord/tag", {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET },
      body: { discordUserId: "100000000000000002", guildId: group.guildId, gameTitle: existingTag?.gameTitle ?? "x", tag: existingTag?.tag ?? "x" },
    });
    const after = photo ? await db.photo.findUnique({ where: { id: photo.id } }) : null;
    check(
      "F250 /tag で直近の投稿に既存のタグのアルバムが付く",
      ingest.status < 300 && !!existingTag && tagged.status === 200 && after?.albumId === existingTag?.autoAlbumId,
      `取り込み${ingest.status} / タグ${!!existingTag} / ${tagged.status} ${tagged.text.slice(0, 60)} / album=${after?.albumId}`
    );
    const unlinked = await api("/api/discord/tag", {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET },
      body: { discordUserId: "100000000000000777", guildId: group.guildId, gameTitle: "x", tag: "x" },
    });
    check("F251 連携していない人の /tag は404", unlinked.status === 404, unlinked.status);

    // **サーバーにいる＝グループのメンバーではない。** 部外者（ログインはできるが、このグループには
    // 入っていない人）の投稿が取り込まれると、他人のグループのアルバムに写真が入り、
    // 初出の #タグ ならアルバムまで作られる。/tag も同じ
    const outsiderMsg = `outsider-${randomUUID()}`;
    const outsiderTag = `outsidertag${randomUUID().slice(0, 6)}`;
    const outsiderIngest = await api("/api/discord/ingest", {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET },
      body: {
        discordUserId: "100000000000000003",
        channelId: "700000000000000001",
        guildId: group.guildId,
        attachmentUrl: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
        contentType: "image/png",
        sizeBytes: 1024,
        discordMessageId: outsiderMsg,
        postedAt: new Date().toISOString(),
        rawTag: outsiderTag,
      },
    });
    const outsiderPhotos = await db.photo.count({ where: { discordMessageId: outsiderMsg } });
    const outsiderTags = await db.discordGameTag.count({ where: { guildId: group.guildId, tag: outsiderTag } });
    const outsiderTagCmd = await api("/api/discord/tag", {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET },
      body: { discordUserId: "100000000000000003", guildId: group.guildId, gameTitle: "部外者のゲーム", tag: outsiderTag },
    });
    const outsiderTagsAfter = await db.discordGameTag.count({ where: { guildId: group.guildId, tag: outsiderTag } });
    check(
      "F287 グループのメンバーでない人の投稿は取り込まず（写真もアルバムも作らない）、/tag も403",
      outsiderIngest.status === 200 && /not a member/.test(outsiderIngest.text) && outsiderPhotos === 0 && outsiderTags === 0 &&
        outsiderTagCmd.status === 403 && outsiderTagsAfter === 0,
      `取り込み=${outsiderIngest.status} ${outsiderIngest.text.slice(0, 60)} / 写真${outsiderPhotos} タグ${outsiderTags} / tag=${outsiderTagCmd.status} タグ${outsiderTagsAfter}`
    );
  } finally {
    // アルバムに入ったのでキャッシュに載っている。API経由で消す（lessons.md）
    if (photo) await api(`/api/photos/${photo.id}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── グループのメンバー管理と、招待の落とし穴（取り消し・グループ削除） ──
{
  const made = await api("/api/groups", {
    method: "POST",
    cookie: adminCookie,
    body: { name: `メンバー管理テスト-${randomUUID().slice(0, 8)}` },
  });
  const gid = made.json?.group?.id;
  const memberUser = await db.user.findUnique({ where: { email: "member@example.com" } });
  const pending = ["199000000000000020", "199000000000000021", "199000000000000022"];
  try {
    const added = await api(`/api/groups/${gid}/members`, {
      method: "POST",
      cookie: adminCookie,
      body: { email: "member@example.com", role: "VIEWER" },
    });
    const patched = await api(`/api/groups/${gid}/members/${memberUser.id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "EDITOR" },
    });
    const row = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: gid, userId: memberUser.id } } });
    const joined = await db.activityLog.count({ where: { groupId: gid, kind: "member.joined", targetId: memberUser.id } });
    check(
      "F252 グループのメンバーの役割を変えられ、役割の変更では「加入」が増えない",
      added.status === 201 && patched.status === 200 && row?.role === "EDITOR" && joined === 1,
      `追加${added.status} / 変更${patched.status} / ${row?.role} / 加入${joined}件`
    );

    const owner = await api(`/api/groups/${gid}/members/${memberUser.id}`, { method: "PATCH", cookie: adminCookie, body: { role: "OWNER" } });
    const junk = await api(`/api/groups/${gid}/members`, { method: "POST", cookie: adminCookie, body: { email: "member@example.com", role: "" } });
    const stranger = await api(`/api/groups/${gid}/members/no-such-user`, { method: "DELETE", cookie: adminCookie });
    check(
      "F253 グループの役割に OWNER や空の値は渡せず（400）、メンバーでない人は404",
      owner.status === 400 && junk.status === 400 && stranger.status === 404,
      `OWNER=${owner.status} / 空=${junk.status} / 非メンバー=${stranger.status}`
    );

    const removed = await api(`/api/groups/${gid}/members/${memberUser.id}`, { method: "DELETE", cookie: adminCookie });
    const view = await api(`/api/groups/${gid}`, { cookie: memberCookie });
    check("F254 外したメンバーはグループを見られなくなる", removed.status === 200 && view.status === 403, `${removed.status} / ${view.status}`);

    // 招待の取り消しで、リンクを踏んでログインしただけの人（未加入の予約）が許可リストから消える。
    // **revokedAt を立てるだけでは足りない**（CLAUDE.md）。別の有効なリンクの予約は残る
    const issue = () => api(`/api/groups/${gid}/invites`, { method: "POST", cookie: adminCookie, body: { role: "VIEWER", maxUses: 5, expiresInHours: 24 } });
    const inv1 = (await issue()).json?.invite;
    const inv2 = (await issue()).json?.invite;
    // 予約の作り方（ログイン時の消費）そのものは F236 で確かめているので、ここは行を直接置く
    await db.allowlistEntry.create({ data: { discordUserId: pending[0], inviteId: inv1.id, note: "棚卸しテスト（取り消すリンク）" } });
    await db.allowlistEntry.create({ data: { discordUserId: pending[1], inviteId: inv2.id, note: "棚卸しテスト（残るリンク）" } });
    const revoke = await api(`/api/groups/${gid}/invites/${inv1.id}`, { method: "DELETE", cookie: adminCookie });
    const revokedEntry = await db.allowlistEntry.findFirst({ where: { discordUserId: pending[0] } });
    const otherEntry = await db.allowlistEntry.findFirst({ where: { discordUserId: pending[1] } });
    check(
      "F255 招待を取り消すと、そのリンクを踏んだだけの人の許可リスト登録が消える（他のリンクの分は残る）",
      revoke.status === 200 && revokedEntry === null && !!otherEntry,
      `${revoke.status} / 取り消した分:${revokedEntry ? "残っている" : "消えた"} / 他:${otherEntry ? "残" : "消"}`
    );

    // グループを消すと、未加入の予約も消える（onDelete: Cascade。SetNull だと恒久ログインになる）
    await db.allowlistEntry.create({ data: { discordUserId: pending[2], inviteId: inv2.id, note: "棚卸しテスト（グループ削除）" } });
    const del = await api(`/api/groups/${gid}`, { method: "DELETE", cookie: adminCookie });
    const leftovers = await db.allowlistEntry.count({ where: { discordUserId: { in: pending.slice(1) } } });
    check(
      "F256 グループを消すと、そのグループのリンクを踏んだだけの人の許可リスト登録も消える",
      del.status === 200 && leftovers === 0,
      `${del.status} / 残った予約${leftovers}件`
    );
  } catch (e) {
    check("F252x グループのメンバー管理・招待の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    await db.allowlistEntry.deleteMany({ where: { discordUserId: { in: pending } } });
    if (gid) await api(`/api/groups/${gid}`, { method: "DELETE", cookie: adminCookie });
  }
}

// ── 動画のサムネイルを、別の行が参照している間は消さない ──
// サムネイルには写真の行が無いので、素朴に「行を消したらファイルも消す」と全動画のサムネイルが壊れる（CLAUDE.md）。
// アルバムに入れない（未分類）ので、行をDB直で作ってもキャッシュには載らない
{
  const key = `gapcheck/${randomUUID()}.png`;
  const url = `http://127.0.0.1:9100/gh-local/${key}`;
  await fetch(url, { method: "PUT", headers: { "content-type": "image/png" }, body: Buffer.alloc(16) });
  const memberUser = await db.user.findUnique({ where: { email: "member@example.com" } });
  const image = await db.photo.create({
    data: { mediaType: "IMAGE", mediaUrl: url, uploaderId: memberUser.id, source: "MANUAL", sizeBytes: 16 },
  });
  const video = await db.photo.create({
    data: {
      mediaType: "VIDEO",
      mediaUrl: `http://127.0.0.1:9100/gh-local/gapcheck/${randomUUID()}.mp4`,
      thumbnailUrl: url,
      uploaderId: memberUser.id,
      source: "MANUAL",
      sizeBytes: 16,
    },
  });
  try {
    const delImage = await api(`/api/photos/${image.id}`, { method: "DELETE", cookie: adminCookie });
    const stillThere = (await fetch(url, { method: "HEAD" })).status;
    check(
      "F257 写真を消しても、動画のサムネイルとして参照されているファイルは残る",
      delImage.status === 200 && stillThere === 200,
      `${delImage.status} / ファイル${stillThere}`
    );
    const delVideo = await api(`/api/photos/${video.id}`, { method: "DELETE", cookie: adminCookie });
    const goneNow = (await fetch(url, { method: "HEAD" })).status;
    check(
      "F258 最後の参照（動画）を消すと、サムネイルのファイルも消える（孤児を残さない）",
      delVideo.status === 200 && goneNow === 404,
      `${delVideo.status} / ファイル${goneNow}`
    );
  } finally {
    await db.photo.deleteMany({ where: { id: { in: [image.id, video.id] } } });
  }
}

// ── Botのイベント処理（偽のDiscordオブジェクトを渡し、送り先のWebは本物） ──
// 遡り取り込み（F134〜）と同じ形。Discordには繋がらないので、Botが受け取るオブジェクトの
// うち処理が読む分だけを持たせる
{
  process.env.INTERNAL_API_BASE_URL ??= BASE;
  process.env.INTERNAL_API_SECRET ??= INTERNAL_SECRET;
  const { handleMessageCreate } = await import("../../apps/bot/dist/handlers/messageCreate.js");

  const replies = [];
  const fakeMessage = (id, { bot = false, contentType = "image/png", name = "clipboard.png" } = {}) => ({
    id,
    author: { bot, id: "100000000000000002", tag: "tester" },
    content: "",
    channelId: "700000000000000001",
    guildId: group.guildId,
    createdTimestamp: Date.now(),
    attachments: new Map([
      [`a-${id}`, { id: `att-${id}`, url: "http://127.0.0.1:9100/gh-local/photos/shot1.png", contentType, size: 1024, name }],
    ]),
    reply: async (payload) => {
      replies.push({ id, payload });
      return {};
    },
  });
  const prefix = `botmsg-${randomUUID().slice(0, 8)}`;
  const photosOf = (id) => db.photo.findMany({ where: { discordMessageId: { startsWith: `${id}:` } } });
  const repliesTo = (id) => replies.filter((r) => r.id === id);
  const made = [];
  try {
    await handleMessageCreate(fakeMessage(`${prefix}-bot`, { bot: true }));
    await handleMessageCreate(fakeMessage(`${prefix}-txt`, { contentType: "text/plain", name: "memo.txt" }));
    const skipped = (await photosOf(`${prefix}-bot`)).length + (await photosOf(`${prefix}-txt`)).length;
    check("F259 Botの投稿と、画像・動画以外の添付は取り込まない（質問もしない）", skipped === 0 && replies.length === 0, `取り込み${skipped}件 / 質問${replies.length}回`);

    await handleMessageCreate(fakeMessage(`${prefix}-clip`));
    const clip = await photosOf(`${prefix}-clip`);
    made.push(...clip);
    const asked = repliesTo(`${prefix}-clip`);
    check(
      "F260 ゲームが分からない投稿は未分類で取り込み、「どのゲーム？」を1回だけ聞く",
      clip.length === 1 && clip[0].albumId === null && asked.length === 1 && asked[0].payload?.components?.length === 1,
      `取り込み${clip.length}件 / album=${clip[0]?.albumId} / 質問${asked.length}回`
    );

    await handleMessageCreate(fakeMessage(`${prefix}-steam`, { name: "1245620_20260810120000_1.png" }));
    const steam = await photosOf(`${prefix}-steam`);
    made.push(...steam);
    check(
      "F261 Steamのスクショ（ファイル名にapp ID）は、聞かずにアルバムが決まる",
      steam.length === 1 && steam[0].albumId !== null && repliesTo(`${prefix}-steam`).length === 0,
      `取り込み${steam.length}件 / album=${steam[0]?.albumId} / 質問${repliesTo(`${prefix}-steam`).length}回`
    );
  } catch (e) {
    check("F259x Botの投稿の取り込みの確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // アルバムに入ったものはキャッシュに載るので API 経由で消す（lessons.md）
    for (const p of made) await api(`/api/photos/${p.id}`, { method: "DELETE", cookie: adminCookie });
  }
}

// `/playlog status`：本人のプレイ中が別のサーバーでは見えていて、このサーバーでは見えない＝このサーバーの
// 「アクティビティのステータス」がオフ（2026-10-24。週末ゲーミングで全員分が届かず、同じ人のゲームがテスト用サーバーでは見えていた）
{
  const { describePlayStatus } = await import("../../apps/bot/dist/lib/playLog.js");
  const NOW = 1_800_000_000_000;
  const base = {
    now: NOW,
    ready: true,
    eligibleCount: 4,
    minParticipants: 2,
    membersFetchedAt: NOW - 60_000,
    voiceChannelId: null,
    voiceChannelName: null,
    inVoice: [],
    lastSend: null,
  };
  const off = describePlayStatus({ ...base, askerPlayingHere: false, askerPlayingElsewhere: [{ guildName: "テスト用", games: ["Timberborn"] }] });
  const on = describePlayStatus({ ...base, askerPlayingHere: true, askerPlayingElsewhere: [{ guildName: "テスト用", games: ["Timberborn"] }] });
  const none = describePlayStatus({ ...base, askerPlayingHere: false, askerPlayingElsewhere: [] });
  const SAY = "このサーバーでは見えていません";
  check(
    "F319 /playlog status：本人のゲームが Bot のいる別のサーバーでは見えていてここでは見えないとき、そのサーバー名とゲーム名を挙げて、このサーバーの「アクティビティのステータス」がオフだと言い切る（ここで見えている・どこでも見えないときは言わない）",
    off.includes(SAY) && off.includes("「テスト用」（Timberborn）") && off.includes("「アクティビティのステータス」がオフ") &&
      !on.includes(SAY) && !none.includes(SAY),
    off.slice(0, 300)
  );
}

{
  const { startPlayTracker, refreshPlayMembersNow, describePlayStatusFor } = await import(
    "../../apps/bot/dist/lib/playTracker.js"
  );
  const internal = { "x-internal-secret": INTERNAL_SECRET };
  const APP = "510000000000000077";
  const VC = "800000000000000009";
  const people = ["100000000000000001", "100000000000000002", "100000000000000003"]; // admin, member, outsider
  const startedAt = new Date(Date.now() - 60 * 1000);
  const guild = {
    id: group.guildId,
    voiceStates: { cache: new Map(people.map((id) => [id, { id, channelId: VC }])) },
    presences: {
      cache: new Map(
        people.map((id) => [id, { activities: [{ type: 0, name: "ウィッチャー3", applicationId: APP, timestamps: { start: startedAt } }] }])
      ),
    },
  };
  const client = { guilds: { cache: new Map([[group.guildId, guild]]) } };
  const sessions = () => db.groupPlaySession.findMany({ where: { groupId: group.id }, include: { participants: true } });

  await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
  await api("/api/internal/bot-heartbeat", { method: "POST", headers: internal });
  try {
    await startPlayTracker(client, null);
    let rows = await sessions();
    check(
      "F262 Botの起動時に、VCで一緒に遊んでいる組がWebへ送られ記録が始まる（部外者は数えない）",
      rows.length === 1 && rows[0].endedAt === null && rows[0].participants.length === 2,
      JSON.stringify(rows.map((r) => ({ endedAt: r.endedAt, n: r.participants.length })))
    );

    // 本物のBotの状態から組み立てる（純粋関数の F264〜F266 と違い、追跡側が値を渡せているか）
    const statusText = await describePlayStatusFor(group.guildId, "100000000000000001");
    check(
      "F267 /playlog status：Botの追跡状態から、VCの対象者・組・最後の送信の成功が出る（部外者は対象外）",
      statusText.includes("いま記録される組：ウィッチャー3（2人）") &&
        statusText.includes("<@100000000000000003>：対象外") &&
        /最後の送信：.*成功（記録中の組 1）/.test(statusText),
      statusText
    );

    // 1人がVCを抜ける → 対象者が1人になる → 次の送信で閉じる
    guild.voiceStates.cache.delete("100000000000000002");
    await refreshPlayMembersNow(group.guildId);
    rows = await sessions();
    check(
      "F263 1人がVCを抜けて条件が崩れると、次の送信で記録が閉じる",
      rows.length === 1 && rows[0].endedAt !== null,
      JSON.stringify(rows.map((r) => ({ endedAt: r.endedAt })))
    );

    // 本人のプレイ中がこのサーバーでは届かず、Botのいる別のサーバーでは届いている（サーバーごとの設定がオフ）。
    // 追跡側が別のサーバーのプレイ状況を拾って渡せているか（F319 は表示の組み立てだけ）
    guild.presences.cache.delete("100000000000000001");
    const OTHER = "900000000000000123";
    client.guilds.cache.set(OTHER, {
      id: OTHER,
      name: "テスト用サーバー",
      voiceStates: { cache: new Map() },
      presences: { cache: new Map([["100000000000000001", { activities: [{ type: 0, name: "Timberborn", applicationId: null, timestamps: null }] }]]) },
    });
    const privacyText = await describePlayStatusFor(group.guildId, "100000000000000001");
    client.guilds.cache.delete(OTHER);
    check(
      "F320 /playlog status：Botの追跡状態から、別のサーバーでは本人のゲームが見えていることを拾い、このサーバーの「アクティビティのステータス」がオフだと出す",
      privacyText.includes("「テスト用サーバー」（Timberborn）") && privacyText.includes("「アクティビティのステータス」がオフ"),
      privacyText.slice(0, 300)
    );
  } catch (e) {
    check("F262x Botのプレイ状況の送信の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    await db.groupPlaySession.deleteMany({ where: { groupId: group.id } });
    await db.discordAppSteamMapping.deleteMany({ where: { discordApplicationId: APP } });
  }
}

// ── ゲーム詳細の HowLongToBeat：取れなかったゲームでも枠を出し「データなし」と書く（2026-10-21 ユーザー判断） ──
// 以前は取れなかったゲームではカードごと出さず、「無い」のか「出し忘れ」なのか画面から分からなかった。
// 取れているゲームでは今までどおり時間の行が出て、「データなし」は出ない
{
  const games = await db.groupGame.findMany({ where: { groupId: group.id }, select: { id: true, title: true, hltbGameId: true, hltbMainHours: true } });
  const missing = games.find((g) => g.hltbGameId === null);
  const present = games.find((g) => g.hltbGameId !== null && g.hltbMainHours !== null);
  const pageOf = async (g) => (g ? (await api(`/groups/${group.id}/games/${g.id}`, { cookie: adminCookie })).text : "");
  const [missingHtml, presentHtml] = await Promise.all([pageOf(missing), pageOf(present)]);
  check(
    "F308 ゲーム詳細：HowLongToBeat が取れなかったゲームでも枠と「データなし」が出る。取れたゲームでは時間が出て「データなし」は出ない",
    !!missing && !!present &&
      missingHtml.includes('data-testid="hltb-empty"') && missingHtml.includes("HowLongToBeat のデータなし") &&
      presentHtml.includes("クリアのみ") && !presentHtml.includes('data-testid="hltb-empty"'),
    `取れなかった=${missing?.title ?? "該当なし"}（枠=${missingHtml.includes('data-testid="hltb-empty"')}） / 取れた=${present?.title ?? "該当なし"}（時間=${presentHtml.includes("クリアのみ")}・データなし=${presentHtml.includes('data-testid="hltb-empty"')}）`
  );
}

// ── テーマの色（2026-10-22。設定 → プロフィールで選ぶ） ──
// API は決まった6色だけを受け付け、表示名と別々に保存できる。画面の色はログイン情報（JWT）に載った値で
// (main)/layout.tsx が書き出す（DB は引かない）。ログイン画面はレイアウトを通らないので既定（globals.css）のまま
{
  const member = await db.user.findUnique({ where: { email: "member@example.com" }, select: { id: true, name: true, themeColor: true } });
  try {
    const set = await api("/api/users/me", { method: "PATCH", cookie: memberCookie, body: { themeColor: "purple" } });
    const got = await api("/api/users/me", { cookie: memberCookie });
    const bad = await api("/api/users/me", { method: "PATCH", cookie: memberCookie, body: { themeColor: "neon" } });
    const empty = await api("/api/users/me", { method: "PATCH", cookie: memberCookie, body: {} });
    const nameOnly = await api("/api/users/me", { method: "PATCH", cookie: memberCookie, body: { name: member.name } });
    const after = await db.user.findUnique({ where: { id: member.id }, select: { name: true, themeColor: true } });
    const purpleToken = await encode({ token: { name: "member", email: "member@example.com", sub: "member@example.com", themeColor: "purple" }, secret: SECRET, maxAge: 3600 });
    const [purpleHome, plainHome, login] = await Promise.all([
      api("/", { cookie: `next-auth.session-token=${purpleToken}` }),
      api("/", { cookie: memberCookie }),
      api("/login"),
    ]);
    const themeOf = (html) => html.match(/<style id="theme-color" data-theme="([a-z]+)">([^<]*)<\/style>/);
    // スマホのURLバーの色（<meta name="theme-color">）も、その人の背景の色になる
    const barOf = (html) => html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1] ?? null;
    const p = themeOf(purpleHome.text);
    const b = themeOf(plainHome.text);
    check(
      "F315 テーマの色: API は6色だけを受け付け（知らない色・空は400）、表示名だけの保存では色が変わらない。画面はログイン情報の色で描かれ（背景とスマホのURLバーの色も。色の無い古いトークンはブルー）、ログイン画面は既定のまま",
      set.status === 200 && set.json?.user?.themeColor === "purple" && got.json?.user?.themeColor === "purple" &&
        bad.status === 400 && empty.status === 400 && nameOnly.status === 200 &&
        after?.themeColor === "purple" && after?.name === member.name &&
        p?.[1] === "purple" && p?.[2].includes("--accent:179 148 255") && p?.[2].includes("--c-bg:23 20 26") && barOf(purpleHome.text) === "#17141a" &&
        b?.[1] === "blue" && b?.[2].includes("--accent:90 176 234") && b?.[2].includes("--c-bg:17 22 29") && barOf(plainHome.text) === "#11161d" &&
        barOf(login.text) === "#11161d" &&
        login.status === 200 && !login.text.includes('id="theme-color"'),
      `PATCH=${set.status}/${set.json?.user?.themeColor} GET=${got.json?.user?.themeColor} 知らない色=${bad.status} 空=${empty.status} 名前だけ=${nameOnly.status} DB=${JSON.stringify(after)} / ` +
        `紫のトークン=${p?.[1]}:${p?.[2]?.slice(0, 50)}・URLバー=${barOf(purpleHome.text)} 色なし=${b?.[1]}・URLバー=${barOf(plainHome.text)} ログイン画面のURLバー=${barOf(login.text)}・${login.status}:${login.text.includes('id="theme-color"')}`
    );
  } catch (e) {
    check("F315x テーマの色の確認が途中で例外になった（以降は未確認）", false, e?.stack ?? e);
  } finally {
    // 色はログイン情報にしか効かず、キャッシュにも載せていないので DB から直接戻してよい
    await db.user.update({ where: { id: member.id }, data: { themeColor: member.themeColor } });
  }
}

// ── /admin の「サーバーの実行環境」（2026-10-22）。実際に動いている Node.js の版と、修正版かの札が出る ──
// テストのサーバーの版は process.version と同じ（同じ機械で動かしている）。CI と手元で版が違っても通るよう、札は判定関数の結果と比べない
{
  const page = await api("/admin", { cookie: adminCookie });
  const at = page.text.indexOf('data-testid="admin-node-version"');
  const sec = at >= 0 ? page.text.slice(at, page.text.indexOf("</section>", at)) : "";
  const plain = sec.replace(/<!-- -->/g, "");
  const badge = ["修正済み", "修正前", "判定できない"].find((b) => plain.includes(b));
  check(
    "F317 /admin に本番で動いている Node.js の版と、修正版かどうかの札が出る",
    page.status === 200 && plain.includes(process.version) && Boolean(badge),
    `status=${page.status} 節=${Boolean(sec)} 版=${plain.includes(process.version)}（${process.version}） 札=${badge ?? "無し"}`
  );
}

// ── ホーム画面に「アプリとして」入れるための設定（Web アプリのマニフェスト。2026-10-23） ──
// ログイン前（招待リンクを開いた人・ログイン画面）にも取りに来るので、Cookie 無しで取れること。
// アイコンは書いてある大きさの PNG が本当に返ること（大きさが違うと Chrome が「インストール」を出さない）
{
  const res = await fetch(BASE + "/manifest.webmanifest", { redirect: "manual" });
  let m = null;
  try {
    m = await res.json();
  } catch {}
  const icons = [];
  for (const icon of m?.icons ?? []) {
    const r = await fetch(BASE + icon.src, { redirect: "manual" });
    const buf = Buffer.from(await r.arrayBuffer());
    const png = buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG";
    const size = png ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : "-";
    icons.push({ src: icon.src, status: r.status, type: r.headers.get("content-type"), size, want: icon.sizes, purpose: icon.purpose });
  }
  const [login, home] = await Promise.all([api("/login"), api("/", { cookie: memberCookie })]);
  const linked = (html) => /<link rel="manifest" href="\/manifest\.webmanifest"/.test(html);
  const sizes = new Set(icons.map((i) => i.want));
  check(
    "F318 マニフェストがログイン前でも取れ、名前・全画面で開く設定・192と512のアイコン（切り抜き用も）を持ち、アイコンは書いた大きさの PNG が返る。ログイン画面とホームの HTML から読まれている",
    res.status === 200 && m?.name === "ShareStaq" && m?.display === "standalone" && m?.start_url === "/" &&
      sizes.has("192x192") && sizes.has("512x512") && icons.some((i) => i.purpose === "maskable") &&
      icons.length > 0 && icons.every((i) => i.status === 200 && /image\/png/.test(i.type ?? "") && i.size === i.want) &&
      linked(login.text) && linked(home.text),
    `status=${res.status} name=${m?.name} display=${m?.display} start=${m?.start_url} アイコン=${JSON.stringify(icons)} ログイン画面=${linked(login.text)} ホーム=${linked(home.text)}`
  );
}

const summary = writeResults("flows", "F: 主要導線", results);
console.table(results.filter((r) => !r.ok));
await db.$disconnect();
process.exitCode = summary.failed > 0 ? 1 : 0;
