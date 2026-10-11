import { db } from "./db";
import { getSteamAppSummary } from "./steam";

/**
 * プレイ記録（グループとして一緒に遊んだ時間）。設計は docs/play-log.md。
 *
 * **Botは「いまの状態」をそのまま送ってくる（スナップショット）。** 始まった・終わったの
 * イベントにしていないのは、1件取りこぼすと行が開きっぱなし／閉じっぱなしになるため。
 * スナップショットなら次に届いた時点で辻褄が合う。行の開閉はここで決める。
 *
 * このファイルは権限を判定しない（`lib/weeklySummary.ts` と同じ役割分担）。
 * 内部APIは共有シークレットで、画面は `hasGroupPermission` を通してから呼ぶ。
 */

/** 途切れがこれ以内なら同じ1回として続ける（誰かのクラッシュで一時的に1人になった等） */
export const MERGE_GAP_MS = 10 * 60 * 1000;

/** 一覧に出す最短の長さ。**保存はする**（あとでしきい値を変えても過去分に効くように） */
export const MIN_DISPLAY_MS = 5 * 60 * 1000;

/**
 * Botの生存報告がこれより古ければ、進行中の行は「最後に生きていた時刻で終わった」とみなして出す。
 * 生存報告は15分おきなので、1回飛んだくらいでは切らない。
 */
const HEARTBEAT_STALE_MS = 35 * 60 * 1000;

/** 2段目で英語名が足りないとき、1回の照合で appdetails を引く上限（数百本を一度に引かない） */
const ENGLISH_NAME_FETCH_LIMIT = 10;

export type SnapshotParticipant = {
  discordUserId: string;
  /** Discordのアクティビティが持つ開始時刻（エポックミリ秒）。無いこともある */
  since?: number | null;
};

export type SnapshotActivity = {
  voiceChannelId: string;
  applicationId: string | null;
  name: string;
  participants: SnapshotParticipant[];
};

export type PlaySnapshot = {
  guildId: string;
  activities: SnapshotActivity[];
  /**
   * 起動直後の1回目だけ付く「前回生きていた時刻」。
   * 落ちていた間をまたいで遊び続けていた組を、閉じた行の続きとしてつなぐのに使う。
   */
  resumeAfter?: string | null;
};

/**
 * 名前の照合用に正規化する。全角半角・大文字小文字・記号（™®：・- 空白など）の差を消す。
 * Steamは「The Witcher® 3: Wild Hunt」、Discordは「The Witcher 3: Wild Hunt」のように、
 * 記号だけ違うことがよくある。
 */
export function normalizeGameName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

export function gameKeyOf(activity: { applicationId: string | null; name: string }): string {
  return activity.applicationId ? `app:${activity.applicationId}` : `name:${normalizeGameName(activity.name)}`;
}

/** グループで数えてよい人（Discord連携済み・外れていない・オーナーかメンバー）。Discordユーザー → User.id */
export async function getEligibleMembers(groupId: string): Promise<Map<string, string>> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: {
      owner: { select: { id: true, discordUserId: true } },
      members: { select: { user: { select: { id: true, discordUserId: true } } } },
      playLogOptOuts: { select: { userId: true } },
    },
  });
  if (!group) return new Map();

  const optedOut = new Set(group.playLogOptOuts.map((o) => o.userId));
  const result = new Map<string, string>();
  for (const u of [group.owner, ...group.members.map((m) => m.user)]) {
    if (u.discordUserId && !optedOut.has(u.id)) result.set(u.discordUserId, u.id);
  }
  return result;
}

type GameCandidate = { id: string; steamAppId: number; title: string; englishName: string | null };

/**
 * 英語名が無いゲームだけ appdetails を引いて埋める。
 *
 * `ExternalGameCache.englishName` はこの機能と一緒に足した列で、それより前に追加された
 * ゲームには入っていない。**取れなかったものは保存しない**（`CLAUDE.md`「失敗を取得済みとして
 * 保存してはいけない」）。行が無いゲームはその場で使うだけにする（行を作ると、外部3サービスの
 * 引き直しの判定に影響するため）。
 */
async function fillEnglishNames(games: GameCandidate[]): Promise<void> {
  const missing = games.filter((g) => g.englishName === null).slice(0, ENGLISH_NAME_FETCH_LIMIT);
  await Promise.all(
    missing.map(async (g) => {
      const summary = await getSteamAppSummary(g.steamAppId).catch(() => null);
      if (!summary?.name) return;
      g.englishName = summary.name;
      await db.externalGameCache
        .updateMany({ where: { steamAppId: g.steamAppId, englishName: null }, data: { englishName: summary.name } })
        .catch((e) => console.error("[playLog] 英語名の保存に失敗", e));
    })
  );
}

async function loadGameCandidates(groupId: string): Promise<GameCandidate[]> {
  const games = await db.groupGame.findMany({
    where: { groupId },
    select: { id: true, steamAppId: true, title: true },
  });
  const caches = await db.externalGameCache.findMany({
    where: { steamAppId: { in: games.map((g) => g.steamAppId) } },
    select: { steamAppId: true, englishName: true },
  });
  const names = new Map(caches.map((c) => [c.steamAppId, c.englishName]));
  return games.map((g) => ({ ...g, englishName: names.get(g.steamAppId) ?? null }));
}

/**
 * 対応付けの1段目と2段目。当たらなければ null（名前だけで記録し、グループ画面から選んでもらう）。
 *
 * 1. DiscordのアプリIDが対応表にあれば、そのSteamのゲームがグループのリストにあるか
 * 2. 表示名を、リストの日本語名・英語名の両方と照らす。当たったらアプリIDの対応を保存する
 *
 * `fetchMissingNames` は英語名が足りないときに appdetails を引くか。画面の描画中は引かない。
 */
export async function matchGroupGame(
  groupId: string,
  activity: { applicationId: string | null; name: string },
  { fetchMissingNames = true }: { fetchMissingNames?: boolean } = {}
): Promise<string | null> {
  const candidates = await loadGameCandidates(groupId);
  if (candidates.length === 0) return null;

  if (activity.applicationId) {
    const mapping = await db.discordAppSteamMapping.findUnique({
      where: { discordApplicationId: activity.applicationId },
    });
    if (mapping) {
      const hit = candidates.find((g) => g.steamAppId === mapping.steamAppId);
      if (hit) return hit.id;
    }
  }

  const target = normalizeGameName(activity.name);
  if (!target) return null;
  const byTitle = candidates.filter((g) => normalizeGameName(g.title) === target);
  let hits = byTitle;
  if (hits.length === 0) {
    if (fetchMissingNames) await fillEnglishNames(candidates);
    hits = candidates.filter((g) => g.englishName && normalizeGameName(g.englishName) === target);
  }
  // 2本以上に当たるのは名前が曖昧なとき。勝手に選ばず、人に選んでもらう
  if (hits.length !== 1) return null;

  if (activity.applicationId) {
    // **既にある対応は上書きしない。** 人が選んだものを名前の一致で潰さないため
    await db.discordAppSteamMapping
      .createMany({
        data: [{ discordApplicationId: activity.applicationId, steamAppId: hits[0].steamAppId }],
        skipDuplicates: true,
      })
      .catch((e) => console.error("[playLog] 対応の保存に失敗", e));
  }
  return hits[0].id;
}

type ResolvedActivity = {
  voiceChannelId: string;
  applicationId: string | null;
  name: string;
  gameKey: string;
  /** User.id → アクティビティの開始時刻 */
  participants: Map<string, number | null>;
};

/**
 * スナップショットを反映する。返り値は開いた・続けた・閉じた行の数（ログと確認用）。
 *
 * 人数の条件（2人以上）と対象者の絞り込みは**ここでもう一度かける**。Botの判定を
 * 信用しきらないのは、Botの対象者一覧が古いまま（外れた直後など）でも数えないようにするため。
 */
export async function applySnapshot(snapshot: PlaySnapshot, now = new Date()) {
  const group = await db.group.findUnique({ where: { guildId: snapshot.guildId }, select: { id: true } });
  if (!group) return { skipped: "no-group" as const };

  const eligible = await getEligibleMembers(group.id);
  const resolved: ResolvedActivity[] = [];
  for (const a of snapshot.activities) {
    const participants = new Map<string, number | null>();
    for (const p of a.participants) {
      const userId = eligible.get(p.discordUserId);
      if (userId) participants.set(userId, typeof p.since === "number" ? p.since : null);
    }
    if (participants.size < 2) continue;
    resolved.push({ ...a, gameKey: gameKeyOf(a), participants });
  }

  const open = await db.groupPlaySession.findMany({
    where: { groupId: group.id, endedAt: null },
    include: { participants: true },
  });
  const claimed = new Set<string>();
  const resumeAfter = snapshot.resumeAfter ? new Date(snapshot.resumeAfter) : null;
  let opened = 0;
  let continued = 0;

  for (const a of resolved) {
    // 同じVC・同じゲームの進行中 → 同じゲームでVCだけ移った進行中 の順に探す
    let session =
      open.find((s) => !claimed.has(s.id) && s.gameKey === a.gameKey && s.voiceChannelId === a.voiceChannelId) ??
      open.find((s) => !claimed.has(s.id) && s.gameKey === a.gameKey) ??
      null;
    if (!session) session = await findResumable(group.id, a, now, resumeAfter, claimed);

    if (session) {
      claimed.add(session.id);
      continued++;
      await db.$transaction([
        db.groupPlaySession.update({
          where: { id: session.id },
          // `estimated` は触らない。Botの停止で閉じた行（estimated）をつないだ場合は、
          // 落ちていた間を「遊んでいた」と推定しているので、印は残したままにする
          data: { endedAt: null, voiceChannelId: a.voiceChannelId },
        }),
        ...syncParticipants(session.id, session.participants, a.participants, now),
      ]);
      continue;
    }

    const groupGameId = await matchGroupGame(group.id, a);
    await db.groupPlaySession.create({
      data: {
        groupId: group.id,
        groupGameId,
        gameKey: a.gameKey,
        discordApplicationId: a.applicationId,
        activityName: a.name.slice(0, 200),
        voiceChannelId: a.voiceChannelId,
        startedAt: now,
        participants: {
          create: [...a.participants.keys()].map((userId) => ({ userId, joinedAt: now })),
        },
      },
    });
    opened++;
  }

  const toClose = open.filter((s) => !claimed.has(s.id));
  if (toClose.length > 0) {
    const ids = toClose.map((s) => s.id);
    await db.$transaction([
      db.groupPlaySession.updateMany({ where: { id: { in: ids } }, data: { endedAt: now } }),
      db.groupPlayParticipant.updateMany({
        where: { sessionId: { in: ids }, leftAt: null },
        data: { leftAt: now },
      }),
    ]);
  }

  return { opened, continued, closed: toClose.length };
}

/**
 * 閉じた行のうち、続きとしてつなげるものを探す。
 *
 * - 閉じてから10分以内（`MERGE_GAP_MS`）なら、同じ1回として続ける
 * - 起動直後（`resumeAfter` あり）は、Botが落ちたことで閉じた行（`estimated`）を、
 *   **参加者の誰かのアクティビティが落ちる前から続いているとき**だけつなぐ。
 *   開始時刻が分からないものはつながない（一晩落ちていた間を「遊んでいた」にしないため）。
 *   以前は「2人以上」だったが、プレイ中が見えない人（オンライン状態を隠す）も組に数えるように
 *   したため、開始時刻が分かるのが1人だけの組が普通にある（2026-10-11）
 */
async function findResumable(
  groupId: string,
  a: ResolvedActivity,
  now: Date,
  resumeAfter: Date | null,
  claimed: Set<string>
) {
  // 同じゲームを別々のVCで同時に始めた2組が、同じ閉じた行を取り合わないように除く
  const notClaimed = { id: { notIn: [...claimed] } };
  const recent = await db.groupPlaySession.findFirst({
    where: {
      groupId,
      gameKey: a.gameKey,
      endedAt: { gte: new Date(now.getTime() - MERGE_GAP_MS) },
      ...notClaimed,
    },
    orderBy: { endedAt: "desc" },
    include: { participants: true },
  });
  if (recent) return recent;

  if (!resumeAfter || Number.isNaN(resumeAfter.getTime())) return null;
  const continuing = [...a.participants.values()].filter(
    (since) => since !== null && since <= resumeAfter.getTime()
  ).length;
  if (continuing < 1) return null;

  return db.groupPlaySession.findFirst({
    where: {
      groupId,
      gameKey: a.gameKey,
      estimated: true,
      endedAt: { gte: new Date(resumeAfter.getTime() - 60 * 1000) },
      ...notClaimed,
    },
    orderBy: { endedAt: "desc" },
    include: { participants: true },
  });
}

function syncParticipants(
  sessionId: string,
  current: { userId: string; leftAt: Date | null }[],
  present: Map<string, number | null>,
  now: Date
) {
  const ops = [];
  const known = new Map(current.map((p) => [p.userId, p]));
  for (const userId of present.keys()) {
    const p = known.get(userId);
    if (!p) {
      ops.push(db.groupPlayParticipant.create({ data: { sessionId, userId, joinedAt: now } }));
    } else if (p.leftAt !== null) {
      ops.push(
        db.groupPlayParticipant.update({
          where: { sessionId_userId: { sessionId, userId } },
          data: { leftAt: null },
        })
      );
    }
  }
  const gone = current.filter((p) => p.leftAt === null && !present.has(p.userId)).map((p) => p.userId);
  if (gone.length > 0) {
    ops.push(
      db.groupPlayParticipant.updateMany({
        where: { sessionId, userId: { in: gone }, leftAt: null },
        data: { leftAt: now },
      })
    );
  }
  return ops;
}

/**
 * Botが落ちていた間に終わったものとして、進行中の行を全部閉じる。
 *
 * 終了時刻は「最後に生きていた時刻」（少なめに数える側に倒す）で、`estimated` を立てる。
 * 起動直後と、日次cronでBotが落ちていると分かったときに呼ぶ。
 */
export async function closeOpenSessionsAt(lastSeenAt: Date) {
  const open = await db.groupPlaySession.findMany({
    where: { endedAt: null },
    select: { id: true, startedAt: true },
  });
  for (const s of open) {
    const endedAt = s.startedAt > lastSeenAt ? s.startedAt : lastSeenAt;
    await db.$transaction([
      db.groupPlaySession.update({ where: { id: s.id }, data: { endedAt, estimated: true } }),
      db.groupPlayParticipant.updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: endedAt } }),
    ]);
  }
  return open.length;
}

/** `/playlog` の状態。Botはこれを文面にして本人にだけ返す */
export type PlayLogStatus = "no-group" | "unlinked" | "not-member" | "counted" | "opted-out";

export async function setPlayLogOptOut(
  guildId: string,
  discordUserId: string,
  action: "on" | "off" | "status"
): Promise<PlayLogStatus> {
  const group = await db.group.findUnique({
    where: { guildId },
    select: { id: true, ownerId: true },
  });
  if (!group) return "no-group";

  const user = await db.user.findUnique({ where: { discordUserId }, select: { id: true } });
  if (!user) return "unlinked";

  const isMember =
    group.ownerId === user.id ||
    (await db.groupMember.count({ where: { groupId: group.id, userId: user.id } })) > 0;
  if (!isMember) return "not-member";

  const key = { groupId_userId: { groupId: group.id, userId: user.id } };
  if (action === "off") {
    await db.playLogOptOut.upsert({ where: key, create: { groupId: group.id, userId: user.id }, update: {} });
    return "opted-out";
  }
  if (action === "on") {
    await db.playLogOptOut.deleteMany({ where: { groupId: group.id, userId: user.id } });
    return "counted";
  }
  const optedOut = await db.playLogOptOut.findUnique({ where: key });
  return optedOut ? "opted-out" : "counted";
}

// ───────────────────────────────────────────────────────────
// 画面向けの読み取り
// ───────────────────────────────────────────────────────────

type Interval = { start: number; end: number };

/** 重なりを除いた合計（同じゲームを別々のVCで同時に遊んでいた場合に二重に数えない） */
function unionMs(intervals: Interval[]): number {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let cur: Interval | null = null;
  for (const i of sorted) {
    if (!cur || i.start > cur.end) {
      if (cur) total += cur.end - cur.start;
      cur = { ...i };
    } else if (i.end > cur.end) {
      cur.end = i.end;
    }
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

export type PlaySessionView = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  estimated: boolean;
  inProgress: boolean;
  participants: string[];
};

export type GamePlaySummary = {
  totalMs: number;
  sessionCount: number;
  lastPlayedAt: string | null;
  recent: PlaySessionView[];
};

/**
 * 進行中の行の「いまの終わり」。Botの生存報告が途絶えていたら、最後に生きていた時刻で切る
 * （日次cronが閉じるまでの間、何日も「進行中」と出し続けないため）。
 */
async function effectiveNow(now: Date): Promise<{ end: Date; stale: boolean }> {
  const hb = await db.botHeartbeat.findUnique({ where: { id: "bot" }, select: { lastSeenAt: true } });
  if (!hb || now.getTime() - hb.lastSeenAt.getTime() > HEARTBEAT_STALE_MS) {
    return { end: hb?.lastSeenAt ?? now, stale: true };
  }
  return { end: now, stale: false };
}

export async function getGamePlaySummary(groupGameId: string, now = new Date(), limit = 10): Promise<GamePlaySummary> {
  const sessions = await db.groupPlaySession.findMany({
    where: { groupGameId },
    orderBy: { startedAt: "desc" },
    include: {
      participants: {
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });
  if (sessions.length === 0) return { totalMs: 0, sessionCount: 0, lastPlayedAt: null, recent: [] };

  const live = await effectiveNow(now);
  const views: PlaySessionView[] = sessions.map((s) => {
    const inProgress = s.endedAt === null && !live.stale;
    const end = s.endedAt ?? (live.end > s.startedAt ? live.end : s.startedAt);
    return {
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      durationMs: end.getTime() - s.startedAt.getTime(),
      estimated: s.estimated || (s.endedAt === null && live.stale),
      inProgress,
      participants: s.participants.map((p) => p.user.name ?? p.user.email ?? "メンバー"),
    };
  });

  const totalMs = unionMs(
    views.map((v) => ({ start: Date.parse(v.startedAt), end: Date.parse(v.startedAt) + v.durationMs }))
  );
  // 一覧は5分以上のものだけ（進行中は短くても出す。いま遊んでいることが分かるように）
  const shown = views.filter((v) => v.inProgress || v.durationMs >= MIN_DISPLAY_MS);
  const lastPlayedAt = views[0].inProgress ? now.toISOString() : views[0].endedAt ?? views[0].startedAt;

  return { totalMs, sessionCount: shown.length, lastPlayedAt, recent: shown.slice(0, limit) };
}

export type UnknownPlay = {
  gameKey: string;
  activityName: string;
  sessionCount: number;
  lastStartedAt: string;
};

/**
 * ゲームが分からないプレイ（名前だけで記録したもの）を、ゲームごとにまとめて返す。
 *
 * **出す前に1段目・2段目でもう一度当ててみる。** 記録した後でゲームをリストに足すと、
 * それだけで過去分が結びつく（ゲームを足す経路は複数あるので、足す側ではなくここで拾う）。
 * 描画中なので appdetails は引かない（英語名は追加時にキャッシュへ入っている）。
 */
export async function getUnknownPlays(groupId: string): Promise<UnknownPlay[]> {
  const rows = await db.groupPlaySession.findMany({
    where: { groupId, groupGameId: null },
    orderBy: { startedAt: "desc" },
    select: { gameKey: true, activityName: true, discordApplicationId: true, startedAt: true },
  });
  if (rows.length === 0) return [];

  const byKey = new Map<string, { activityName: string; applicationId: string | null; count: number; last: Date }>();
  for (const r of rows) {
    const cur = byKey.get(r.gameKey);
    if (cur) cur.count++;
    else byKey.set(r.gameKey, { activityName: r.activityName, applicationId: r.discordApplicationId, count: 1, last: r.startedAt });
  }

  const result: UnknownPlay[] = [];
  for (const [gameKey, v] of byKey) {
    const hit = await matchGroupGame(groupId, { applicationId: v.applicationId, name: v.activityName }, { fetchMissingNames: false });
    if (hit) {
      await db.groupPlaySession.updateMany({ where: { groupId, gameKey, groupGameId: null }, data: { groupGameId: hit } });
      continue;
    }
    result.push({ gameKey, activityName: v.activityName, sessionCount: v.count, lastStartedAt: v.last.toISOString() });
  }
  return result;
}

/**
 * 3段目：分からなかったプレイに、グループのゲームを選んで結びつける。
 * アプリIDがあれば対応表にも保存し、次からは自動で当たるようにする（人が選んだ対応は上書きする）。
 */
export async function assignUnknownPlay(groupId: string, gameKey: string, groupGameId: string) {
  const game = await db.groupGame.findFirst({ where: { id: groupGameId, groupId }, select: { steamAppId: true } });
  if (!game) return { ok: false as const, reason: "game-not-found" as const };

  const sample = await db.groupPlaySession.findFirst({
    where: { groupId, gameKey },
    select: { discordApplicationId: true },
  });
  if (!sample) return { ok: false as const, reason: "play-not-found" as const };

  if (sample.discordApplicationId) {
    await db.discordAppSteamMapping.upsert({
      where: { discordApplicationId: sample.discordApplicationId },
      create: { discordApplicationId: sample.discordApplicationId, steamAppId: game.steamAppId },
      update: { steamAppId: game.steamAppId },
    });
  }
  const { count } = await db.groupPlaySession.updateMany({
    where: { groupId, gameKey, groupGameId: null },
    data: { groupGameId },
  });
  return { ok: true as const, updated: count };
}
