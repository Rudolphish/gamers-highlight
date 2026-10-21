import { db } from "./db";
import { getSteamAppSummary } from "./steam";
import { jstDateString } from "./jst";
import { getRawAppSetting, playLogMinParticipantsKey } from "./appSettings";

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

/** 記録の最少人数の既定。「一緒に遊んだ」なので2人 */
export const PLAY_LOG_MIN_PARTICIPANTS_DEFAULT = 2;

/**
 * そのグループの記録の最少人数（1 か 2）。1 は管理者がテスト用に切り替えたときだけ
 * （`playLogMinParticipantsKey` の説明を参照）。BotとWebの両方がこの値で判定する
 */
export async function getPlayLogMinParticipants(groupId: string): Promise<1 | 2> {
  return (await getRawAppSetting(playLogMinParticipantsKey(groupId))) === "1" ? 1 : PLAY_LOG_MIN_PARTICIPANTS_DEFAULT;
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
 * 人数の条件（既定は2人以上。`getPlayLogMinParticipants`）と対象者の絞り込みは**ここでもう一度かける**。Botの判定を
 * 信用しきらないのは、Botの対象者一覧が古いまま（外れた直後など）でも数えないようにするため。
 */
export async function applySnapshot(snapshot: PlaySnapshot, now = new Date()) {
  const group = await db.group.findUnique({ where: { guildId: snapshot.guildId }, select: { id: true } });
  if (!group) return { skipped: "no-group" as const };

  const eligible = await getEligibleMembers(group.id);
  const minParticipants = await getPlayLogMinParticipants(group.id);
  const resolved: ResolvedActivity[] = [];
  for (const a of snapshot.activities) {
    const participants = new Map<string, number | null>();
    for (const p of a.participants) {
      const userId = eligible.get(p.discordUserId);
      if (userId) participants.set(userId, typeof p.since === "number" ? p.since : null);
    }
    if (participants.size < minParticipants) continue;
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
  /** 新しく始まった行。開始の通知に使う（つなぎ直した行は含めない） */
  const openedIds: string[] = [];

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
          // 終了の通知は閉じてから10分後なので普段は未送信のまま。送った後につながったとき
          // （Botの再起動の直後に送信が遅れた等）は外して、本当に終わったときにもう一度送る
          data: { endedAt: null, voiceChannelId: a.voiceChannelId, endNotifiedAt: null },
        }),
        ...syncParticipants(session.id, session.participants, a.participants, now),
      ]);
      continue;
    }

    const groupGameId = await matchGroupGame(group.id, a);
    const created = await db.groupPlaySession.create({
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
    openedIds.push(created.id);
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

  return { opened, continued, closed: toClose.length, openedIds };
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

/**
 * 1回ぶんの始まりと終わり。**ゲーム詳細とグループ画面で必ずこれを通す**（数字を食い違わせないため。docs/play-log.md §13）。
 * 進行中の行は「いまの終わり」まで数える（Botが落ちていたら最後に生きていた時刻で切る）。
 */
function sessionSpan(s: { startedAt: Date; endedAt: Date | null }, live: { end: Date }): Interval {
  const end = s.endedAt ?? (live.end > s.startedAt ? live.end : s.startedAt);
  return { start: s.startedAt.getTime(), end: end.getTime() };
}

export type GroupPlayTotals = {
  /** 各ゲームの時間の和（ゲーム一覧の合計と必ず一致する。別々のVCで同時に別のゲームを遊んだ時間は両方数える） */
  totalMs: number;
  /** 時間が1分でも付いているゲームの本数 */
  gameCount: number;
  /** GroupGame.id → そのゲームの時間（ゲーム詳細の合計と同じ数え方。同じゲームの重なりは1回だけ数える） */
  byGame: Record<string, number>;
  /** 時間が最も長いゲーム。同じ時間なら最後に遊んだ方 */
  topGameId: string | null;
  /** 一番新しく遊んだ時刻（進行中なら今） */
  lastPlayedAt: string | null;
};

/**
 * グループ画面の帯とゲーム一覧に出す時間（docs/play-log.md §13）。
 *
 * - **ゲームに結びついていない記録は数えない**（ユーザー判断）。結びつけた時点で入る
 * - グループの記録はまとめて1回で引く（ゲームごとに引くと本番では本数ぶん往復する）
 * - キャッシュには載せない（Botの記録・管理者の修正のたびに無効化が要るのを避ける）
 */
export async function getGroupPlayTotals(groupId: string, now = new Date()): Promise<GroupPlayTotals> {
  const sessions = await db.groupPlaySession.findMany({
    where: { groupId, groupGameId: { not: null } },
    select: { groupGameId: true, startedAt: true, endedAt: true },
  });
  if (sessions.length === 0) return { totalMs: 0, gameCount: 0, byGame: {}, topGameId: null, lastPlayedAt: null };

  const live = await effectiveNow(now);
  const spans = new Map<string, Interval[]>();
  const lastEnd = new Map<string, number>();
  let latest = 0;
  for (const s of sessions) {
    const span = sessionSpan(s, live);
    const id = s.groupGameId!;
    spans.set(id, [...(spans.get(id) ?? []), span]);
    // 進行中（Botが生きている）なら「いま」。表示の「最後に遊んだ日」を今日にする
    const end = s.endedAt === null && !live.stale ? now.getTime() : span.end;
    lastEnd.set(id, Math.max(lastEnd.get(id) ?? 0, end));
    latest = Math.max(latest, end);
  }

  const byGame: Record<string, number> = {};
  let totalMs = 0;
  let topGameId: string | null = null;
  for (const [id, list] of spans) {
    const ms = unionMs(list);
    if (ms < 60 * 1000) continue; // 1分未満は「遊んだ」に数えない（一覧に「1分未満」を並べない）
    byGame[id] = ms;
    totalMs += ms;
    const top = topGameId ? byGame[topGameId] : -1;
    if (ms > top || (ms === top && (lastEnd.get(id) ?? 0) > (lastEnd.get(topGameId!) ?? 0))) topGameId = id;
  }
  return {
    totalMs,
    gameCount: Object.keys(byGame).length,
    byGame,
    topGameId,
    lastPlayedAt: totalMs > 0 ? new Date(latest).toISOString() : null,
  };
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
    const span = sessionSpan(s, live);
    return {
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      durationMs: span.end - span.start,
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

export type PlayCalendarEntry = {
  id: string;
  startedAt: Date;
  durationMs: number;
  /** 結びついていればゲームリストの名前、無ければ Discord の表示名 */
  title: string;
  groupGameId: string | null;
  participants: string[];
  estimated: boolean;
  inProgress: boolean;
};

export type PlayCalendar = {
  /** JSTの `YYYY-MM-DD`（始まった日）→ その日の合計。遊んだ日だけが入る */
  days: Record<string, { totalMs: number; sessionCount: number }>;
  /** 新しい順 */
  entries: PlayCalendarEntry[];
};

/**
 * 活動カレンダーに載せるプレイ記録（docs/play-log.md §11）。`period` の間に**始まった**回を返す。
 *
 * - **日付をまたいだ回は始まった日（JST）にまとめる。** 夜中の1回が2日に割れて2つの思い出に見えないように
 * - 出すのはゲーム詳細の一覧と同じく5分以上の回（進行中は短くても出す）。日の合計もその回だけで数えるので、
 *   タイムラインに並んだ行と日のマスの数字が食い違わない
 * - 日の合計は、同じゲームの重なりを1回だけ数えてからゲームごとに足す（`getGroupPlayTotals` と同じ考え方）。
 *   結びついていない記録は Discord の名前ごとに1本として扱う（カレンダーには遊んだ事実をそのまま出す）
 * - `ActivityLog` には写さず、ここで直接読む。写すと、つなぎ直した回や後から結びつけ直した回でずれる
 */
export async function getPlayCalendar(groupId: string, period: { start: Date; end: Date }, now = new Date()): Promise<PlayCalendar> {
  const sessions = await db.groupPlaySession.findMany({
    where: { groupId, startedAt: { gte: period.start, lt: period.end } },
    orderBy: { startedAt: "desc" },
    include: PLAY_ENTRY_INCLUDE,
  });
  if (sessions.length === 0) return { days: {}, entries: [] };

  const built = await toPlayEntries(sessions, now);
  const spans = new Map<string, Map<string, Interval[]>>(); // 日 → ゲーム → 区間
  for (const { entry, span, gameKey } of built) {
    const day = jstDateString(entry.startedAt);
    const byGame = spans.get(day) ?? new Map<string, Interval[]>();
    const key = entry.groupGameId ?? `key:${gameKey}`;
    byGame.set(key, [...(byGame.get(key) ?? []), span]);
    spans.set(day, byGame);
  }

  const days: PlayCalendar["days"] = {};
  for (const [day, byGame] of spans) {
    let totalMs = 0;
    let sessionCount = 0;
    for (const list of byGame.values()) {
      totalMs += unionMs(list);
      sessionCount += list.length;
    }
    days[day] = { totalMs, sessionCount };
  }
  return { days, entries: built.map((b) => b.entry) };
}

/**
 * 「最近の動き」に混ぜる、新しく始まった順のプレイ記録（docs/play-log.md §11 の段階2）。グループ画面（1グループ）と
 * ホームの「みんなの動き」（所属グループすべて）の両方で使う。
 * 出す・出さないの基準はカレンダーと同じ（5分未満は出さない。進行中は出す）。短い回で枠が埋まらないよう少し多めに引いてから絞る。
 * **グループの数によらず1回で読む。** グループごとに読むと、所属グループが増えるたびにホームの往復が増える（query-budget の Q01）
 */
export async function getRecentPlaysForGroups(
  groupIds: string[],
  limit: number,
  now = new Date()
): Promise<{ groupId: string; entry: PlayCalendarEntry }[]> {
  if (groupIds.length === 0) return [];
  const sessions = await db.groupPlaySession.findMany({
    where: { groupId: { in: groupIds } },
    orderBy: { startedAt: "desc" },
    take: limit * 3,
    include: PLAY_ENTRY_INCLUDE,
  });
  if (sessions.length === 0) return [];
  const groupOf = new Map(sessions.map((s) => [s.id, s.groupId]));
  return (await toPlayEntries(sessions, now)).slice(0, limit).map((b) => ({ groupId: groupOf.get(b.entry.id)!, entry: b.entry }));
}

const PLAY_ENTRY_INCLUDE = {
  groupGame: { select: { title: true } },
  participants: { orderBy: { joinedAt: "asc" as const }, include: { user: { select: { name: true } } } },
};

type PlayEntrySource = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  estimated: boolean;
  activityName: string;
  gameKey: string;
  groupGameId: string | null;
  groupGame: { title: string } | null;
  participants: { user: { name: string | null } }[];
};

/** カレンダーと「最近の動き」の1行ぶん。5分未満の閉じた回はここで落とす */
async function toPlayEntries(sessions: PlayEntrySource[], now: Date): Promise<{ entry: PlayCalendarEntry; span: Interval; gameKey: string }[]> {
  // 生存報告を引くのは進行中の行があるときだけ（閉じた回だけなら1往復を足さない）
  const live = sessions.some((s) => s.endedAt === null) ? await effectiveNow(now) : { end: now, stale: false };
  const out: { entry: PlayCalendarEntry; span: Interval; gameKey: string }[] = [];
  for (const s of sessions) {
    const span = sessionSpan(s, live);
    const inProgress = s.endedAt === null && !live.stale;
    const durationMs = span.end - span.start;
    if (!inProgress && durationMs < MIN_DISPLAY_MS) continue;
    out.push({
      span,
      gameKey: s.gameKey,
      entry: {
        id: s.id,
        startedAt: s.startedAt,
        durationMs,
        title: s.groupGame?.title ?? s.activityName,
        groupGameId: s.groupGameId,
        // 表示名が無い人をメールで出さない（グループのメンバーに見せるので）
        participants: s.participants.map((p) => p.user.name ?? "メンバー"),
        estimated: s.estimated || (s.endedAt === null && live.stale),
        inProgress,
      },
    });
  }
  return out;
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
