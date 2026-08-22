import { db } from "./db";
import { JST_OFFSET_MS } from "./jst";
import type { ActivityKind } from "./activityLog";

/**
 * 週次まとめの集計。管理画面のプレビューと、将来のDiscord通知が同じものを読む。
 * 設計は docs/activity-log.md。
 *
 * **数えるのは `ActivityLog.createdAt`（記録時刻）で、`occurredAt` ではない。**
 * 「今週なにがあったか」を知らせるものなので、去年撮ったスクショを今週上げたなら
 * 今週の投稿として数えたい。`occurredAt`（撮影日時）で数えるのはカレンダーの側。
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type WeekRange = { start: Date; end: Date; label: string };

/**
 * JSTの月曜0時〜日曜24時を返す。`weekOffset` は 0 が今週、-1 が先週。
 *
 * **境界をJSTにするのは、夜中に上げた写真が前日（前週）扱いになるのを避けるため。**
 * ユーザーも投稿も日本時間で動く。UTCで切ると日曜の夜9時以降の投稿が翌週に落ちる。
 *
 * 実装は「JSTの壁時計をUTCとして読む」形にしてある。サーバーのタイムゾーンに
 * 依存しないので、VercelでもローカルでもCIでも同じ結果になる。
 */
export function jstWeekRange(weekOffset = 0, now = new Date()): WeekRange {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const daysFromMonday = (jstNow.getUTCDay() + 6) % 7; // 0=日曜 を 月曜起点に直す
  const mondayJst = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate() - daysFromMonday + weekOffset * 7
  );
  const start = new Date(mondayJst - JST_OFFSET_MS);
  const end = new Date(start.getTime() + WEEK_MS);
  return { start, end, label: formatRange(start, end) };
}

function formatRange(start: Date, end: Date): string {
  const fmt = (d: Date) => {
    const jst = new Date(d.getTime() + JST_OFFSET_MS);
    return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
  };
  // 終端は「日曜の24時」なので、表示は1ミリ秒引いて日曜の日付にする
  return `${fmt(start)}〜${fmt(new Date(end.getTime() - 1))}`;
}

/** 画面と通知に出す並び。**ここに無い kind は数字として出さない**（内訳が読めなくなるため） */
const COUNTED: { kind: ActivityKind; label: string; emoji: string }[] = [
  { kind: "photo.created", label: "投稿", emoji: "📷" },
  { kind: "photo.reaction_added", label: "リアクション", emoji: "❤️" },
  { kind: "photo.description_set", label: "説明", emoji: "📝" },
  { kind: "album.created", label: "アルバム", emoji: "📁" },
  { kind: "game.added", label: "ゲーム追加", emoji: "🎮" },
  { kind: "game.interest_added", label: "気になる", emoji: "👀" },
  { kind: "proposal.created", label: "提案", emoji: "💡" },
  { kind: "proposal.voted", label: "提案への投票", emoji: "🗳️" },
  { kind: "member.joined", label: "新メンバー", emoji: "👤" },
];

export type WeeklySummary = {
  groupId: string;
  groupName: string;
  range: WeekRange;
  counts: { kind: string; label: string; emoji: string; count: number }[];
  /** 何か1件でも動きがあったか。**0件の週は通知しない**判断に使う */
  hasActivity: boolean;
  /** 今週クリアになったゲーム。ActivityLog が無いと出せない情報 */
  completedGames: string[];
  /** 今週いちばん❤️を集めた写真 */
  topPhoto: { id: string; albumId: string | null; title: string | null; reactions: number } | null;
  /** 今週の投稿者（多い順・上位3人） */
  topPosters: { name: string; count: number }[];
  /** 期間ではなく「いま」の残高。放置されている提案を掘り起こすため */
  pendingProposals: number;
};

export async function getWeeklySummary(
  groupId: string,
  weekOffset = -1,
  now = new Date()
): Promise<WeeklySummary> {
  const range = jstWeekRange(weekOffset, now);
  const period = { gte: range.start, lt: range.end };

  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  });
  if (!group) throw new Error(`グループが見つかりません: ${groupId}`);

  // 件数はまとめて1回で取る（種類ごとにcountを投げると往復が種類の数だけ増える）
  const grouped = await db.activityLog.groupBy({
    by: ["kind"],
    where: { groupId, createdAt: period },
    _count: { _all: true },
  });
  const countOf = (kind: string) =>
    grouped.find((g) => g.kind === kind)?._count._all ?? 0;

  const counts = COUNTED.map((c) => ({ ...c, count: countOf(c.kind) }));

  // **クリアしたゲームは ActivityLog にしか無い。**
  // GroupGame.updatedAt は日次cronの価格チェックで毎日動くので代用できない。
  const completed = await db.activityLog.findMany({
    where: {
      groupId,
      kind: "game.status_changed",
      createdAt: period,
      detail: { path: ["to"], equals: "COMPLETED" },
    },
    select: { targetName: true },
  });

  const [topPhoto, topPosters, pendingProposals] = await Promise.all([
    findTopPhoto(groupId, period),
    findTopPosters(groupId, period),
    db.groupGameProposal.count({ where: { groupId, status: "PENDING" } }),
  ]);

  return {
    groupId: group.id,
    groupName: group.name,
    range,
    counts,
    hasActivity: grouped.some((g) => g._count._all > 0),
    completedGames: completed.map((c) => c.targetName ?? "（名前不明）"),
    topPhoto,
    topPosters,
    pendingProposals,
  };
}

/**
 * 今週いちばん❤️を集めた写真。
 *
 * **取り消し（photo.reaction_removed）は差し引いていない。** 週の中で付けて外した分も
 * 1件として数える。厳密にやるなら差し引けるが、「今週の盛り上がり」を出すのが目的なので
 * 単純さを採った。ここを変えるなら画面の文言も合わせること。
 */
async function findTopPhoto(groupId: string, period: { gte: Date; lt: Date }) {
  const ranked = await db.activityLog.groupBy({
    by: ["targetId"],
    where: { groupId, kind: "photo.reaction_added", createdAt: period },
    _count: { _all: true },
    orderBy: { _count: { targetId: "desc" } },
    take: 3,
  });
  if (ranked.length === 0) return null;

  // **消された写真は飛ばす。** ログにはFKを張っていないので、対象が既に無いことがある
  const photos = await db.photo.findMany({
    where: { id: { in: ranked.map((r) => r.targetId) } },
    select: { id: true, albumId: true, gameTitle: true },
  });
  for (const r of ranked) {
    const photo = photos.find((p) => p.id === r.targetId);
    if (photo) {
      return {
        id: photo.id,
        albumId: photo.albumId,
        title: photo.gameTitle,
        reactions: r._count._all,
      };
    }
  }
  return null;
}

/** 今週の投稿者。名前はUserから引く（ログには名前を持たせていない） */
async function findTopPosters(groupId: string, period: { gte: Date; lt: Date }) {
  const ranked = await db.activityLog.groupBy({
    by: ["actorId"],
    where: { groupId, kind: "photo.created", createdAt: period, actorId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { actorId: "desc" } },
    take: 3,
  });
  if (ranked.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: ranked.map((r) => r.actorId!) } },
    select: { id: true, name: true, email: true },
  });
  return ranked.map((r) => {
    const user = users.find((u) => u.id === r.actorId);
    return { name: user?.name ?? user?.email ?? "（退会）", count: r._count._all };
  });
}

/**
 * Discordへ投げる文面を組み立てる。**画面のプレビューもこれを表示する。**
 * 別々に組み立てると、プレビューで整えた文面と実際に飛ぶ文面がずれる。
 */
export function formatWeeklySummaryText(summary: WeeklySummary): string {
  // **「今週」と書かない。** 通知は週明けに「終わった週」を送るので、届いた時点では
  // 既に先週になっている。管理画面で過去の週を開いたときも「今週」と出て嘘になる。
  // 期間そのものを見出しに出せば、いつ送っても・いつ読んでも正しい。
  const lines: string[] = [`📅 **${summary.groupName}（${summary.range.label}）のまとめ**`, ""];

  const active = summary.counts.filter((c) => c.count > 0);
  if (active.length === 0) {
    lines.push("この週は動きがありませんでした。");
  } else {
    lines.push(active.map((c) => `${c.emoji} ${c.label} ${c.count}`).join("　"));
  }

  if (summary.completedGames.length > 0) {
    lines.push("", `🏆 **クリア**: ${summary.completedGames.join("、")}`);
  }
  if (summary.topPosters.length > 0) {
    lines.push(
      "",
      `📷 よく上げた人: ${summary.topPosters.map((p) => `${p.name}（${p.count}）`).join("、")}`
    );
  }
  if (summary.topPhoto && summary.topPhoto.reactions > 0) {
    const what = summary.topPhoto.title ?? "写真";
    lines.push("", `❤️ いちばん反応があったのは「${what}」（${summary.topPhoto.reactions}件）`);
  }
  if (summary.pendingProposals > 0) {
    lines.push("", `💡 投票待ちの提案が ${summary.pendingProposals} 件あります`);
  }

  return lines.join("\n");
}
