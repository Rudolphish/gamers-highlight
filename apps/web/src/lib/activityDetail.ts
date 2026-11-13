// 「最近の動き」「みんなの動き」の行を押したときのモーダルの中身（2026-11-13 ユーザー判断）。
//
// - **押されたときに1件ぶんだけ読む**（GET /api/activity?ids=…）。グループ画面とホームの問い合わせ回数を増やさないため
//   （グループ画面は上限12回のところ10回使っている）。誰も押さない行の写真や表紙を読まない
// - **権限はその記録のグループで判定する**（メンバーでなければ null＝404）。記録には外部キーが無いので、
//   ids を並べて別のグループの記録を混ぜられないよう、全部が同じグループ・同じ種類であることも確かめる
// - 取り消し系など、グループのメンバーに出さない種類（GROUP_HIDDEN_KINDS）は返さない
// - 「写真を7枚投稿」のようにまとめた行は、まとめた記録の id を全部受け取り、写真を最大 PHOTO_PREVIEW 枚返す
// - 文字（日時など）は全部ここで作る（日本時間。クライアント部品で Date から表示を作らない。CLAUDE.md）
// - 対象が消えていたら `gone` に一言入れる（記録だけは残る）
import { db } from "./db";
import { hasGroupPermission } from "./permissions";
import { GROUP_HIDDEN_KINDS, noteOf, timelineLabel } from "./activityFeed";
import { patchNoteTimeLabel } from "./gameUpdates";
import { gameStatusLabel, PROPOSAL_REACTION_LABELS } from "./gameLabels";
import { formatPlayDuration } from "./playDuration";

/** 1回に受け取る id の上限（まとめた写真の行でも、最近の動きが引く記録の数を超えない） */
export const ACTIVITY_DETAIL_MAX_IDS = 60;
/** モーダルに並べる写真の上限（ユーザー判断） */
export const PHOTO_PREVIEW = 6;

export type ActivityDetail = {
  /** 見出し（「写真を3枚投稿」「ゲームに更新が来た」） */
  title: string;
  /** 「11/13 09:10 · Rudolph」 */
  meta: string;
  /** 上に大きく出す画像（ゲームの表紙・アルバムの表紙） */
  image: { url: string; alt: string } | null;
  /** 写真のサムネイル（写真の種類だけ） */
  photos: { id: string; url: string | null; video: boolean }[];
  /** 並べきれなかった写真の枚数（「ほか N 枚」） */
  morePhotos: number;
  /** 「ゲーム: Timberborn」のような項目 */
  rows: { label: string; value: string }[];
  /** 開ける先。external は新しいタブで開く */
  links: { href: string; label: string; external: boolean }[];
  /** 対象が消えているときの一言 */
  gone: string | null;
};

type Log = {
  id: string;
  kind: string;
  groupId: string | null;
  actorId: string | null;
  targetId: string;
  targetName: string | null;
  detail: unknown;
  createdAt: Date;
};

const nameOf = async (userId: string | null): Promise<string | null> => {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  // 表示名が無い人をメールで出さない（最近の動きと同じ扱い）
  return u ? (u.name ?? "メンバー") : "（退会）";
};

const thumbOf = (p: { mediaType: string; mediaUrl: string; thumbnailUrl: string | null }): string | null =>
  p.thumbnailUrl ?? (p.mediaType === "IMAGE" ? p.mediaUrl : null);

/**
 * 行の詳細。見せられない（ログインしていない人の判定は呼ぶ側）・無い・混ざっている ids は null。
 * ids はプレイ記録なら `play:<セッションID>` を1つ、ほかは記録（ActivityLog）の id
 */
export async function getActivityDetail(userId: string, ids: string[]): Promise<ActivityDetail | null> {
  if (ids.length === 0 || ids.length > ACTIVITY_DETAIL_MAX_IDS) return null;
  if (ids[0].startsWith("play:")) {
    return ids.length === 1 ? playDetail(userId, ids[0].slice("play:".length)) : null;
  }

  const logs: Log[] = await db.activityLog.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, groupId: true, actorId: true, targetId: true, targetName: true, detail: true, createdAt: true },
  });
  if (logs.length !== new Set(ids).size) return null;
  const first = logs[0];
  if (!first.groupId || logs.some((l) => l.groupId !== first.groupId || l.kind !== first.kind)) return null;
  if ((GROUP_HIDDEN_KINDS as readonly string[]).includes(first.kind)) return null;
  // まとめるのは写真の投稿だけ
  if (logs.length > 1 && first.kind !== "photo.created") return null;
  if (!(await hasGroupPermission(first.groupId, userId, "VIEWER"))) return null;

  const actor = await nameOf(first.actorId);
  const meta = [patchNoteTimeLabel(first.createdAt), actor].filter(Boolean).join(" · ");
  const base: ActivityDetail = {
    title: timelineLabel(first.kind),
    meta,
    image: null,
    photos: [],
    morePhotos: 0,
    rows: [],
    links: [],
    gone: null,
  };

  if (first.kind.startsWith("photo.")) return photoDetail(base, logs);
  if (first.kind.startsWith("game.")) return gameDetail(base, first);
  if (first.kind.startsWith("proposal.")) return proposalDetail(base, first);
  if (first.kind.startsWith("album.")) return albumDetail(base, first);
  // グループに参加などは、見出しと日時だけ
  return base;
}

async function photoDetail(base: ActivityDetail, logs: Log[]): Promise<ActivityDetail> {
  const first = logs[0];
  if (logs.length > 1) base.title = `写真を${logs.length}枚投稿`;
  const photos = await db.photo.findMany({
    where: { id: { in: logs.map((l) => l.targetId) } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      mediaType: true,
      mediaUrl: true,
      thumbnailUrl: true,
      gameTitle: true,
      description: true,
      album: { select: { id: true, title: true, groupId: true } },
    },
  });
  if (photos.length === 0) {
    base.gone = logs.length > 1 ? "写真はすべて削除されています" : "この写真は削除されています";
    if (first.targetName) base.rows.push({ label: "ゲーム", value: first.targetName });
    return base;
  }
  base.photos = photos.slice(0, PHOTO_PREVIEW).map((p) => ({ id: p.id, url: thumbOf(p), video: p.mediaType !== "IMAGE" }));
  base.morePhotos = Math.max(0, photos.length - PHOTO_PREVIEW);
  if (photos.length < logs.length) base.gone = `${logs.length - photos.length}枚は削除されています`;

  const games = [...new Set(photos.map((p) => p.gameTitle).filter((t): t is string => !!t))];
  if (games.length > 0) base.rows.push({ label: "ゲーム", value: games.join("・") });
  // 別のグループのアルバムへ移された写真のリンクは出さない（見る権限が無いことがある）
  const albums = new Map<string, string>();
  for (const p of photos) if (p.album && p.album.groupId === first.groupId) albums.set(p.album.id, p.album.title);
  if (albums.size > 0) base.rows.push({ label: "アルバム", value: [...albums.values()].join("・") });
  if (first.kind === "photo.description_set" && photos[0].description) {
    base.rows.push({ label: "説明", value: photos[0].description });
  }
  for (const [id, title] of albums) {
    base.links.push({ href: `/albums/${id}`, label: albums.size > 1 ? `「${title}」を開く` : "アルバムを開く", external: false });
  }
  return base;
}

async function gameDetail(base: ActivityDetail, log: Log): Promise<ActivityDetail> {
  const game = await db.groupGame.findUnique({
    where: { id: log.targetId },
    select: { id: true, groupId: true, title: true, coverUrl: true, status: true, steamAppId: true },
  });
  const name = game?.title ?? log.targetName;
  if (!game || game.groupId !== log.groupId) {
    base.gone = "このゲームはゲームリストから削除されています";
    if (name) base.rows.push({ label: "ゲーム", value: name });
    return base;
  }
  if (game.coverUrl) base.image = { url: game.coverUrl, alt: game.title };
  base.rows.push({ label: "ゲーム", value: game.title }, { label: "ステータス", value: gameStatusLabel(game.status) });
  const note = noteOf(log.kind, log.detail);
  if (log.kind === "game.update_found" && note) {
    base.rows.push({ label: "パッチノート", value: note });
    // 記録には題名しか無いので、ためてあるパッチノートから同じ題名のものを探してリンクにする
    const patch = await db.gamePatchNote.findFirst({
      where: { steamAppId: game.steamAppId, title: note },
      orderBy: { publishedAt: "desc" },
      select: { url: true, publishedAt: true },
    });
    if (patch) base.rows.push({ label: "公開", value: patchNoteTimeLabel(patch.publishedAt) });
    if (patch?.url) base.links.push({ href: patch.url, label: "Steam のお知らせを開く", external: true });
  } else if (log.kind === "game.price_dropped" && note) {
    base.rows.push({ label: "最安値", value: note });
  } else if (log.kind === "game.status_changed" && note) {
    base.rows.push({ label: "変更", value: note });
  }
  base.links.unshift({ href: `/groups/${game.groupId}/games/${game.id}`, label: "ゲーム詳細を開く", external: false });
  return base;
}

async function proposalDetail(base: ActivityDetail, log: Log): Promise<ActivityDetail> {
  const proposal = await db.groupGameProposal.findUnique({
    where: { id: log.targetId },
    select: {
      id: true,
      groupId: true,
      title: true,
      coverUrl: true,
      _count: { select: { purchases: true } },
      reactions: { where: { type: "LIKE" }, select: { id: true } },
    },
  });
  if (!proposal || proposal.groupId !== log.groupId) {
    base.gone = "この提案は取り下げられたか、ゲームリストに移っています";
    if (log.targetName) base.rows.push({ label: "ゲーム", value: log.targetName });
    return base;
  }
  if (proposal.coverUrl) base.image = { url: proposal.coverUrl, alt: proposal.title };
  base.rows.push(
    { label: "ゲーム", value: proposal.title },
    { label: PROPOSAL_REACTION_LABELS.LIKE, value: `${proposal.reactions.length}人` },
    { label: "買った", value: `${proposal._count.purchases}人` }
  );
  base.links.push({ href: `/groups/${proposal.groupId}/proposals/${proposal.id}`, label: "提案を開く", external: false });
  return base;
}

async function albumDetail(base: ActivityDetail, log: Log): Promise<ActivityDetail> {
  const album = await db.album.findUnique({
    where: { id: log.targetId },
    select: {
      id: true,
      groupId: true,
      title: true,
      _count: { select: { photos: true } },
      photos: {
        where: { mediaType: "IMAGE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { mediaType: true, mediaUrl: true, thumbnailUrl: true },
      },
    },
  });
  if (!album || album.groupId !== log.groupId) {
    base.gone = "このアルバムは削除されています";
    if (log.targetName) base.rows.push({ label: "アルバム", value: log.targetName });
    return base;
  }
  const cover = album.photos[0] ? thumbOf(album.photos[0]) : null;
  if (cover) base.image = { url: cover, alt: album.title };
  base.rows.push({ label: "アルバム", value: album.title }, { label: "写真・動画", value: `${album._count.photos}件` });
  base.links.push({ href: `/albums/${album.id}`, label: "アルバムを開く", external: false });
  return base;
}

async function playDetail(userId: string, sessionId: string): Promise<ActivityDetail | null> {
  const session = await db.groupPlaySession.findUnique({
    where: { id: sessionId },
    select: {
      groupId: true,
      activityName: true,
      startedAt: true,
      endedAt: true,
      estimated: true,
      groupGame: { select: { id: true, title: true, coverUrl: true } },
      participants: { orderBy: { joinedAt: "asc" }, select: { user: { select: { name: true } } } },
    },
  });
  if (!session || !(await hasGroupPermission(session.groupId, userId, "VIEWER"))) return null;
  const title = session.groupGame?.title ?? session.activityName;
  const end = session.endedAt ?? new Date();
  // 終わりは、同じ日なら時刻だけ、日をまたいだら日付から書く
  const startLabel = patchNoteTimeLabel(session.startedAt);
  const endLabel = session.endedAt ? patchNoteTimeLabel(session.endedAt) : "いま";
  const sameDay = endLabel.split(" ")[0] === startLabel.split(" ")[0];
  const endShown = session.endedAt && sameDay ? endLabel.split(" ")[1] : endLabel;
  const detail: ActivityDetail = {
    title: session.endedAt ? `${title} を遊んだ` : `${title} を遊んでいる`,
    meta: patchNoteTimeLabel(session.startedAt),
    image: session.groupGame?.coverUrl ? { url: session.groupGame.coverUrl, alt: title } : null,
    photos: [],
    morePhotos: 0,
    rows: [
      { label: "ゲーム", value: title },
      {
        label: "時間",
        value: `${startLabel} 〜 ${endShown}（${formatPlayDuration(end.getTime() - session.startedAt.getTime())}${session.estimated ? "・終わりは推定" : ""}）`,
      },
      { label: "遊んだ人", value: session.participants.map((p) => p.user.name ?? "メンバー").join("・") || "—" },
    ],
    links: session.groupGame
      ? [{ href: `/groups/${session.groupId}/games/${session.groupGame.id}`, label: "ゲーム詳細を開く", external: false }]
      : [],
    gone: null,
  };
  return detail;
}
