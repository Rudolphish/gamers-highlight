import type { Client, Guild } from "discord.js";
import { fetchPlayLogMembers, notifyPlayLogBotStarted, sendPlaySnapshot } from "./apiClient.js";
import { computePlayingGroups, snapshotSignature, type ActivityLike } from "./playLog.js";

/**
 * プレイ記録の見張り役。VCの出入りとプレイ状況の変化を受けて、サーバーごとに
 * 「いまどのVCで誰が何を遊んでいるか」を計算し、**変わったときだけ**Webへ送る。
 * 行の開閉はWebが決める（apps/web/src/lib/playLog.ts）。設計は docs/play-log.md §5。
 *
 * **プレイ状況の通知は頻繁に来る**（ゲーム内の場面が変わるだけでも届く）。
 * 少し待ってまとめ（DEBOUNCE_MS）、さらに前回送った内容と同じなら送らない。
 */

/** 同じサーバーの通知が続いたら、これだけ待ってから1回だけ計算する */
const DEBOUNCE_MS = 3000;

/** 対象者の一覧をこれより古くなったら取り直す。`/playlog` を打たれたときは即座に取り直す */
const MEMBERS_TTL_MS = 15 * 60 * 1000;

type GuildState = {
  /** null＝このサーバーにはグループが無い（見ない） */
  eligible: Set<string> | null;
  membersFetchedAt: number;
  /** 最後に**送れた**内容。送れなかったときは更新しないので、次の機会に送り直す */
  lastSent: string | null;
  timer: NodeJS.Timeout | null;
  /** 送信を直列にする（順序が入れ替わって古い状態で上書きしないため） */
  chain: Promise<void>;
};

const states = new Map<string, GuildState>();
let client: Client | null = null;
/** 起動処理（進行中の記録を閉じる）が済むまでは送らない。先に送ると、開いた行をすぐ閉じられる */
let ready = false;
/** 起動直後の1回目だけ付ける「前回生きていた時刻」。サーバーごとに、送れたら消す */
const pendingResume = new Map<string, string>();

function stateOf(guildId: string): GuildState {
  let s = states.get(guildId);
  if (!s) {
    s = { eligible: null, membersFetchedAt: 0, lastSent: null, timer: null, chain: Promise.resolve() };
    states.set(guildId, s);
  }
  return s;
}

async function refreshMembers(guildId: string, force = false): Promise<void> {
  const s = stateOf(guildId);
  if (!force && Date.now() - s.membersFetchedAt < MEMBERS_TTL_MS) return;
  const res = await fetchPlayLogMembers(guildId);
  // 取れなかったときは前回の一覧のまま（Webが落ちている間に全員を対象外にしない）
  if (!res) return;
  s.eligible = res.group ? new Set(res.discordUserIds) : null;
  s.membersFetchedAt = Date.now();
}

function activitiesOf(guild: Guild, userId: string): ActivityLike[] {
  const presence = guild.presences.cache.get(userId);
  if (!presence) return [];
  return presence.activities.map((a) => ({
    type: a.type,
    name: a.name,
    applicationId: a.applicationId ?? null,
    startedAt: a.timestamps?.start?.getTime() ?? null,
  }));
}

async function sync(guildId: string, { force = false }: { force?: boolean } = {}): Promise<void> {
  const guild = client?.guilds.cache.get(guildId);
  if (!guild) return;
  const s = stateOf(guildId);

  await refreshMembers(guildId);
  if (!s.eligible) return;

  const voice = [...guild.voiceStates.cache.values()]
    .filter((v) => v.channelId !== null)
    .map((v) => ({ userId: v.id, channelId: v.channelId as string }));
  const groups = computePlayingGroups(voice, (id) => activitiesOf(guild, id), s.eligible);
  const signature = snapshotSignature(groups);
  if (!force && signature === s.lastSent) return;

  const resumeAfter = pendingResume.get(guildId) ?? null;
  const ok = await sendPlaySnapshot({ guildId, activities: groups, resumeAfter });
  if (ok) {
    s.lastSent = signature;
    pendingResume.delete(guildId);
  }
}

function enqueue(guildId: string, opts?: { force?: boolean }): Promise<void> {
  const s = stateOf(guildId);
  s.chain = s.chain
    .then(() => sync(guildId, opts))
    .catch((err) => console.error(`[playlog] guild=${guildId} の送信に失敗`, err));
  return s.chain;
}

/** VCの出入り・プレイ状況の変化を受けたら呼ぶ。少し待ってまとめてから計算する */
export function schedulePlaySync(guildId: string | null | undefined): void {
  if (!ready || !guildId) return;
  const s = stateOf(guildId);
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    void enqueue(guildId);
  }, DEBOUNCE_MS);
}

/** `/playlog on|off` の後。対象者を取り直し、すぐに反映する */
export async function refreshPlayMembersNow(guildId: string): Promise<void> {
  await refreshMembers(guildId, true);
  if (ready) await enqueue(guildId);
}

/** 定期の取り直し。送れていなかった分の送り直しも兼ねる（生存報告と同じ間隔で呼ぶ） */
export async function resyncAllPlay(): Promise<void> {
  if (!client || !ready) return;
  for (const guildId of client.guilds.cache.keys()) await enqueue(guildId);
}

/**
 * 起動時に1回。**順序が大事**：
 * 1. 進行中の記録を「前回生きていた時刻」で閉じてもらう（落ちていた間に終わったもの）
 * 2. いまの状態を送る。まだ続いている組は、1で閉じた行の続きとしてWebがつなぎ直す
 *    （`resumeAfter` を付けるのはこの1回だけ）
 */
export async function startPlayTracker(c: Client, previousSeenAt: Date | null): Promise<void> {
  client = c;
  await notifyPlayLogBotStarted(previousSeenAt);
  if (previousSeenAt) {
    for (const guildId of c.guilds.cache.keys()) pendingResume.set(guildId, previousSeenAt.toISOString());
  }
  ready = true;
  for (const guildId of c.guilds.cache.keys()) {
    await refreshMembers(guildId, true);
    await enqueue(guildId, { force: true });
  }
}
