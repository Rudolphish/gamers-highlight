import { randomUUID } from "node:crypto";
import { db } from "./db";

// 管理者がプレイ記録を直す（時間の修正・削除・記録されなかった回の手動追加）。画面は /admin/play-log。
// 設計は docs/play-log.md §12。**権限はここでは判定しない**（API 側で isAdminEmail を通す）。
//
// Bot が付けた記録（GroupPlaySession）をそのまま書き換える。別のテーブルに「修正分」を持たないのは、
// ゲーム詳細の合計・通知・今後の活動カレンダー（§11）がどれもこのテーブルだけを読むから。
//
// **Bot の記録とぶつからないように決めていること**
// - 進行中の行（endedAt が null）は直させない。Bot がまだ開け閉めしている
// - 手動で足した行の gameKey は `manual:<UUID>`、voiceChannelId は `manual`。Bot の gameKey
//   （`app:…` / `name:…`）と重ならないので、10分以内の再開や起動直後のつなぎ直しで Bot に拾われない
// - 終了の通知（lib/playLogNotify.ts）は「閉じてから10分〜6時間で、まだ送っていない行」に送る。
//   手で足した行・直した行に今さら「遊びました」が飛ばないよう、送った印（endNotifiedAt）を付けておく

/** 1回の長さの上限。これを超えるのは入力の間違い（日付の取り違えなど）とみなす */
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
/** 一覧の1ページの件数 */
export const ADMIN_PAGE_SIZE = 50;

export type AdminPlaySession = {
  id: string;
  groupId: string;
  groupName: string;
  groupGameId: string | null;
  /** ゲームリストの名前。結びついていなければ Discord の表示名 */
  title: string;
  activityName: string;
  startedAt: string;
  endedAt: string | null;
  estimated: boolean;
  manual: boolean;
  participants: { userId: string; name: string }[];
};

export type AdminGroupOption = {
  id: string;
  name: string;
  games: { id: string; title: string }[];
  members: { userId: string; name: string }[];
};

// 表示名が無い人はメールにしない（管理画面だが、通知やゲーム詳細と扱いを揃える）
const nameOf = (u: { name: string | null }) => u.name ?? "メンバー";

export async function listAdminPlaySessions(opts: { groupId?: string | null; page?: number }) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const where = opts.groupId ? { groupId: opts.groupId } : {};
  const [total, rows] = await Promise.all([
    db.groupPlaySession.count({ where }),
    db.groupPlaySession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: {
        group: { select: { name: true } },
        groupGame: { select: { title: true } },
        participants: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } } } },
      },
    }),
  ]);
  const sessions: AdminPlaySession[] = rows.map((s) => ({
    id: s.id,
    groupId: s.groupId,
    groupName: s.group.name,
    groupGameId: s.groupGameId,
    title: s.groupGame?.title ?? s.activityName,
    activityName: s.activityName,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    estimated: s.estimated,
    manual: s.gameKey.startsWith("manual:"),
    participants: s.participants.map((p) => ({ userId: p.userId, name: nameOf(p.user) })),
  }));
  return { sessions, total, page, pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

/** 追加・修正のモーダルで選ぶもの（グループごとのゲームとメンバー） */
export async function listAdminGroupOptions(): Promise<AdminGroupOption[]> {
  const groups = await db.group.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      owner: { select: { id: true, name: true } },
      members: { select: { user: { select: { id: true, name: true } } } },
      games: { orderBy: { title: "asc" }, select: { id: true, title: true } },
    },
  });
  return groups.map((g) => {
    const members = new Map<string, string>([[g.owner.id, nameOf(g.owner)]]);
    for (const m of g.members) members.set(m.user.id, nameOf(m.user));
    return {
      id: g.id,
      name: g.name,
      games: g.games,
      members: [...members].map(([userId, name]) => ({ userId, name })),
    };
  });
}

export type SessionInput = {
  startedAt: string;
  endedAt: string;
  groupGameId?: string | null;
  participantIds: string[];
};

type Invalid = { ok: false; status: 400 | 404 | 409; error: string };

function parseTimes(input: Pick<SessionInput, "startedAt" | "endedAt">, now: Date): Invalid | { ok: true; start: Date; end: Date } {
  const start = new Date(input.startedAt);
  const end = new Date(input.endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, status: 400, error: "開始と終了の日時を入れてください" };
  }
  if (end <= start) return { ok: false, status: 400, error: "終了は開始より後にしてください" };
  if (end.getTime() - start.getTime() > MAX_SESSION_MS) {
    return { ok: false, status: 400, error: "1回の長さは24時間までです（日付を確かめてください）" };
  }
  // 時計のずれぶんだけ許す。未来の記録は作らない
  if (end.getTime() > now.getTime() + 60 * 1000) {
    return { ok: false, status: 400, error: "終了をいまより後にはできません" };
  }
  return { ok: true, start, end };
}

/** グループのゲーム・メンバーかを確かめる（別のグループのものを混ぜない） */
async function checkRefs(groupId: string, groupGameId: string | null | undefined, participantIds: string[]): Promise<Invalid | null> {
  if (groupGameId) {
    const game = await db.groupGame.findFirst({ where: { id: groupGameId, groupId }, select: { id: true } });
    if (!game) return { ok: false, status: 400, error: "そのゲームはこのグループのゲームリストにありません" };
  }
  const ids = [...new Set(participantIds)];
  if (ids.length === 0) return { ok: false, status: 400, error: "参加者を1人以上選んでください" };
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true, members: { where: { userId: { in: ids } }, select: { userId: true } } },
  });
  if (!group) return { ok: false, status: 404, error: "グループが見つかりません" };
  const allowed = new Set([group.ownerId, ...group.members.map((m) => m.userId)]);
  if (ids.some((id) => !allowed.has(id))) {
    return { ok: false, status: 400, error: "グループのメンバーでない人は参加者にできません" };
  }
  return null;
}

/** 記録されなかった回を手で足す。ゲームはゲームリストから選ぶ（名前だけの手動記録は作らない） */
export async function createManualSession(groupId: string, input: SessionInput, now = new Date()) {
  const times = parseTimes(input, now);
  if (!times.ok) return times;
  if (!input.groupGameId) return { ok: false as const, status: 400 as const, error: "ゲームを選んでください" };
  const bad = await checkRefs(groupId, input.groupGameId, input.participantIds);
  if (bad) return bad;

  const game = await db.groupGame.findUnique({ where: { id: input.groupGameId }, select: { title: true } });
  const session = await db.groupPlaySession.create({
    data: {
      groupId,
      groupGameId: input.groupGameId,
      gameKey: `manual:${randomUUID()}`,
      activityName: game?.title ?? "手動で追加",
      voiceChannelId: "manual",
      startedAt: times.start,
      endedAt: times.end,
      endNotifiedAt: now,
      participants: {
        create: [...new Set(input.participantIds)].map((userId) => ({ userId, joinedAt: times.start, leftAt: times.end })),
      },
    },
    select: { id: true },
  });
  return { ok: true as const, id: session.id };
}

/**
 * 時間・ゲーム・参加者を直す。参加者を渡したときは入れ替える（残った人は入った・抜けた時刻を新しい範囲に収める）。
 * ゲームを省略（undefined）したら変えない。
 */
export async function updateSession(sessionId: string, input: SessionInput, now = new Date()) {
  const current = await db.groupPlaySession.findUnique({
    where: { id: sessionId },
    select: { groupId: true, endedAt: true, endNotifiedAt: true, participants: { select: { userId: true, joinedAt: true, leftAt: true } } },
  });
  if (!current) return { ok: false as const, status: 404 as const, error: "記録が見つかりません" };
  if (current.endedAt === null) {
    return { ok: false as const, status: 409 as const, error: "進行中の記録は、終わってから直してください" };
  }
  const times = parseTimes(input, now);
  if (!times.ok) return times;
  const bad = await checkRefs(current.groupId, input.groupGameId, input.participantIds);
  if (bad) return bad;

  const keep = new Map(current.participants.map((p) => [p.userId, p]));
  const next = [...new Set(input.participantIds)];
  const clamp = (d: Date) => new Date(Math.min(Math.max(d.getTime(), times.start.getTime()), times.end.getTime()));

  await db.$transaction([
    db.groupPlaySession.update({
      where: { id: sessionId },
      data: {
        startedAt: times.start,
        endedAt: times.end,
        // 直した時点で終わりは推定ではなくなる（人が確かめた値）
        estimated: false,
        ...(input.groupGameId !== undefined ? { groupGameId: input.groupGameId } : {}),
        // 直したことで今さら終了の通知が飛ばないように（上のコメント）
        ...(current.endNotifiedAt === null ? { endNotifiedAt: now } : {}),
      },
    }),
    db.groupPlayParticipant.deleteMany({ where: { sessionId, userId: { notIn: next } } }),
    ...next.map((userId) => {
      const was = keep.get(userId);
      const joinedAt = was ? clamp(was.joinedAt) : times.start;
      const leftAt = was?.leftAt ? clamp(was.leftAt) : times.end;
      return db.groupPlayParticipant.upsert({
        where: { sessionId_userId: { sessionId, userId } },
        create: { sessionId, userId, joinedAt: times.start, leftAt: times.end },
        update: { joinedAt, leftAt },
      });
    }),
  ]);
  return { ok: true as const };
}

export async function deleteSession(sessionId: string) {
  const current = await db.groupPlaySession.findUnique({ where: { id: sessionId }, select: { endedAt: true } });
  if (!current) return { ok: false as const, status: 404 as const, error: "記録が見つかりません" };
  if (current.endedAt === null) {
    return { ok: false as const, status: 409 as const, error: "進行中の記録は、終わってから消してください" };
  }
  // 参加者はカスケードで消える
  await db.groupPlaySession.delete({ where: { id: sessionId } });
  return { ok: true as const };
}
