/**
 * 既存データから活動ログ（ActivityLog）を作り直す。
 *
 *   pnpm --filter @gamers-highlight/db exec tsx backfill-activity-log.ts
 *
 * ログは入れた日から溜まり始めるので、これをやらないと**タイムライン／カレンダーが
 * 最初の1年スカスカ**になる（docs/activity-log.md §7）。
 *
 * **何度流しても同じ結果になるように書いてある。** 途中で失敗したらそのまま流し直せばよい。
 * 判定は kind + targetId の組み合わせ。
 *
 * 遡れないもの: 削除・ステータス変更・説明の編集。
 * これらは元のテーブルに履歴が残っていないので、投入日から先だけになる。
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Row = {
  kind: string;
  targetId: string;
  targetName: string | null;
  groupId: string | null;
  actorId: string | null;
  occurredAt: Date;
  detail?: unknown;
};

/**
 * 既に入っている行は飛ばして、足りない分だけ入れる。
 *
 * 突き合わせの鍵は **kind + targetId + actorId**。targetId だけだと、
 * 1つの提案に複数人が投票している場合（proposal.voted）や、1枚の写真に複数人が
 * ❤️を押している場合に、1件でも入っていると残り全員ぶんが飛ばされる。
 */
async function insertMissing(label: string, rows: Row[]) {
  if (rows.length === 0) {
    console.log(`  ${label}: 対象なし`);
    return;
  }

  const keyOf = (r: { kind: string; targetId: string; actorId: string | null }) =>
    [r.kind, r.targetId, r.actorId ?? ""].join("/");

  const kinds = [...new Set(rows.map((r) => r.kind))];
  const existing = await db.activityLog.findMany({
    where: { kind: { in: kinds }, targetId: { in: rows.map((r) => r.targetId) } },
    select: { kind: true, targetId: true, actorId: true },
  });
  const seen = new Set(existing.map(keyOf));
  const missing = rows.filter((r) => !seen.has(keyOf(r)));

  if (missing.length === 0) {
    console.log(`  ${label}: ${rows.length}件すべて投入済み`);
    return;
  }

  // createMany は skipDuplicates が効かない（@@unique を張っていないため）ので、
  // 上で突き合わせた差分だけを入れる
  await db.activityLog.createMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: missing as any,
  });
  console.log(`  ${label}: ${missing.length}件を投入（既存 ${rows.length - missing.length}件）`);
}

async function main() {
  console.log("活動ログの遡り投入を開始します");

  // --- 写真 ---
  // occurredAt は capturedAt を優先する。去年撮ったスクショを今日上げていた場合、
  // カレンダー上は「撮った日」に置きたい（docs/activity-log.md §3）。
  const photos = await db.photo.findMany({
    select: {
      id: true,
      gameTitle: true,
      uploaderId: true,
      capturedAt: true,
      createdAt: true,
      mediaType: true,
      source: true,
      album: { select: { groupId: true } },
    },
  });
  await insertMissing(
    "photo.created",
    photos.map((p) => ({
      kind: "photo.created",
      targetId: p.id,
      targetName: p.gameTitle,
      groupId: p.album?.groupId ?? null,
      actorId: p.uploaderId,
      occurredAt: p.capturedAt ?? p.createdAt,
      detail: { mediaType: p.mediaType, source: p.source },
    }))
  );

  // --- アルバム ---
  const albums = await db.album.findMany({
    select: { id: true, title: true, groupId: true, ownerId: true, createdAt: true },
  });
  await insertMissing(
    "album.created",
    albums.map((a) => ({
      kind: "album.created",
      targetId: a.id,
      targetName: a.title,
      groupId: a.groupId,
      actorId: a.ownerId,
      occurredAt: a.createdAt,
    }))
  );

  // --- ゲーム ---
  const games = await db.groupGame.findMany({
    select: {
      id: true,
      title: true,
      groupId: true,
      addedById: true,
      createdAt: true,
      status: true,
    },
  });
  await insertMissing(
    "game.added",
    games.map((g) => ({
      kind: "game.added",
      targetId: g.id,
      targetName: g.title,
      groupId: g.groupId,
      actorId: g.addedById,
      occurredAt: g.createdAt,
      // **現在のステータスであって、追加時のものではない。**
      // 追加後に変更されていれば食い違う。履歴が無いので復元できない
      detail: { status: g.status, backfilled: true },
    }))
  );

  // --- ゲームへの「気になる」 ---
  const interests = await db.groupGameInterest.findMany({
    select: {
      id: true,
      userId: true,
      createdAt: true,
      groupGame: { select: { id: true, title: true, groupId: true } },
    },
  });
  await insertMissing(
    "game.interest_added",
    interests.map((i) => ({
      kind: "game.interest_added",
      targetId: i.groupGame.id,
      targetName: i.groupGame.title,
      groupId: i.groupGame.groupId,
      actorId: i.userId,
      occurredAt: i.createdAt,
    }))
  );

  // --- 提案 ---
  const proposals = await db.groupGameProposal.findMany({
    select: {
      id: true,
      title: true,
      groupId: true,
      proposedById: true,
      createdAt: true,
      status: true,
    },
  });
  await insertMissing(
    "proposal.created",
    proposals.map((p) => ({
      kind: "proposal.created",
      targetId: p.id,
      targetName: p.title,
      groupId: p.groupId,
      actorId: p.proposedById,
      occurredAt: p.createdAt,
    }))
  );

  // 提案への投票。targetId は提案なので、1つの提案に複数行（投票した人数ぶん）入る。
  // 突き合わせは actorId まで見ているので、流し直しても重複しない。
  const votes = await db.groupGameProposalReaction.findMany({
    select: {
      userId: true,
      type: true,
      createdAt: true,
      proposal: { select: { id: true, title: true, groupId: true } },
    },
  });
  await insertMissing(
    "proposal.voted",
    votes.map((v) => ({
      kind: "proposal.voted",
      targetId: v.proposal.id,
      targetName: v.proposal.title,
      groupId: v.proposal.groupId,
      actorId: v.userId,
      occurredAt: v.createdAt,
      detail: { type: v.type },
    }))
  );

  // --- 写真への❤️ ---
  const reactions = await db.photoReaction.findMany({
    select: {
      photoId: true,
      userId: true,
      createdAt: true,
      photo: { select: { album: { select: { groupId: true } } } },
    },
  });
  await insertMissing(
    "photo.reaction_added",
    reactions.map((r) => ({
      kind: "photo.reaction_added",
      targetId: r.photoId,
      targetName: null,
      groupId: r.photo.album?.groupId ?? null,
      actorId: r.userId,
      occurredAt: r.createdAt,
    }))
  );

  // --- メンバーの加入 ---
  // acceptedAt が無い（招待されたが未加入）行は対象外
  const members = await db.groupMember.findMany({
    where: { acceptedAt: { not: null } },
    select: {
      groupId: true,
      userId: true,
      acceptedAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  await insertMissing(
    "member.joined",
    members.map((m) => ({
      kind: "member.joined",
      targetId: m.userId,
      targetName: m.user.name ?? m.user.email,
      groupId: m.groupId,
      actorId: m.userId,
      occurredAt: m.acceptedAt!,
    }))
  );

  const total = await db.activityLog.count();
  console.log(`完了。ActivityLog は現在 ${total} 件です`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
