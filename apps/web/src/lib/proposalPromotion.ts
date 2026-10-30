// ウィッシュリスト（提案）がゲームリストに入るまでの段階。**判定と書き込みを1箇所に集める。**
//
//   ウィッシュリスト（PENDING）
//     └ グループの全員が「やりたい」 → 「みんなでやりたい」（AGREED）
//          └ 「やりたい」を押した人が全員「買った」 → ゲームリストの「プレイ予定」（ACCEPTED）
//
// 2026-10-30 にこの形へ変えた（ユーザー判断）。それまでは「やりたい」が過半数に届いた時点で
// 直接ゲームリストに入っていた。誰かが「やりたい」を外したら AGREED からウィッシュリストへ戻す。
//
// 判定するのは投票と購入のAPI、文面に出すのは提案作成時の通知とグループ画面・詳細ページ、
// 説明するのはマニュアル。**同じ条件を別々に書くと、片方だけ変えたときに文面だけが嘘になる**
// （以前、詳細ページだけが過半数の式を書き写していた）。
//
// **オーナーは `GroupMember` の行を持たない。** グループ作成時に作られるのは
// `Group.ownerId` だけなので、全員はメンバー + オーナーになる。
import type { ProposalStatus } from "@gamers-highlight/db";
import { db } from "./db";
import { logActivity } from "./activityLog";
import { getOrFetchExternalGameData } from "./externalGameCache";
import { getNotificationChannel } from "./notificationTargets";
import { postDiscordMessage } from "./discord";

/** まだゲームリストに入っていない提案（ウィッシュリストと「みんなでやりたい」）。PENDING だけを見ていた箇所はこれを使う */
export const OPEN_PROPOSAL_STATUSES: ProposalStatus[] = ["PENDING", "AGREED"];

/**
 * 「みんなでやりたい」に上がるのに要る「やりたい」の数（＝グループの全員）。
 * 人数ではなくIDで数える。テスト用のグループのようにオーナーが `GroupMember` の行も持っていると、
 * 「メンバー数 + 1」では1人多く数えてしまう（判定の `groupUserIds` は重複を除いているので、表示だけがずれる）
 */
export function agreeThreshold(ownerId: string, memberUserIds: string[]): number {
  return new Set([ownerId, ...memberUserIds]).size;
}

/** グループの全員（オーナー＋メンバー）のユーザーID */
export async function groupUserIds(groupId: string): Promise<Set<string>> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true, members: { select: { userId: true } } },
  });
  if (!group) return new Set();
  return new Set([group.ownerId, ...group.members.map((m) => m.userId)]);
}

/**
 * 買う必要がある人＝「やりたい」を押した人のうち、今もグループにいる人。
 * AGREED になった時点では全員と同じだが、あとから入った人は「やりたい」を押していないので含めない。
 * 抜けた人も含めない（抜けた人の「買った」待ちで止まらないように）。
 */
export function requiredPurchasers(
  reactions: { userId: string; type: string }[],
  members: Set<string>
): string[] {
  return reactions.filter((r) => r.type === "LIKE" && members.has(r.userId)).map((r) => r.userId);
}

/**
 * 投票が変わったあとに呼ぶ。全員が「やりたい」なら AGREED へ上げ、そうでなくなったら PENDING へ戻す。
 *
 * **状態の切り替えは `updateMany` の条件付きで行う。** 2人がほぼ同時に最後の1票を入れると、
 * どちらの呼び出しも「全員そろった」と判定する。条件（今の状態）を付けて書き、
 * 実際に書けた1回だけが記録を残す。
 */
export async function syncAgreement(proposalId: string, groupId: string): Promise<"agreed" | "reopened" | null> {
  const [proposal, members] = await Promise.all([
    db.groupGameProposal.findUnique({
      where: { id: proposalId },
      select: { id: true, title: true, status: true, proposedById: true, reactions: { select: { userId: true, type: true } } },
    }),
    groupUserIds(groupId),
  ]);
  if (!proposal || members.size === 0) return null;

  const liked = new Set(requiredPurchasers(proposal.reactions, members));
  const everyone = [...members].every((id) => liked.has(id));

  if (proposal.status === "PENDING" && everyone) {
    // 順位はウィッシュリストの中での並びなので外す（ウィッシュリストへ戻ったときは順位なしで戻る）
    const { count } = await db.groupGameProposal.updateMany({
      where: { id: proposalId, status: "PENDING" },
      data: { status: "AGREED", agreedAt: new Date(), rank: null },
    });
    if (count === 0) return null;
    await logActivity({
      kind: "proposal.agreed",
      targetId: proposal.id,
      targetName: proposal.title,
      groupId,
      actorId: proposal.proposedById,
      detail: { likeCount: liked.size },
    });
    return "agreed";
  }

  if (proposal.status === "AGREED" && !everyone) {
    const { count } = await db.groupGameProposal.updateMany({
      where: { id: proposalId, status: "AGREED" },
      data: { status: "PENDING", agreedAt: null },
    });
    return count === 0 ? null : "reopened";
  }

  return null;
}

/**
 * 「買った」が変わったあとに呼ぶ。買う必要がある人が全員そろったら、ゲームリストに「プレイ予定」で入れる。
 * 入れたら true。
 *
 * 「追加した人」（`GroupGame.addedById`）と記録の actor は**提案者**（最後に買った人ではない）。
 * 画面と週次まとめで食い違わないように、以前の過半数での採用と揃えてある。
 */
export async function completeIfAllPurchased(proposalId: string, groupId: string): Promise<boolean> {
  const [proposal, members] = await Promise.all([
    db.groupGameProposal.findUnique({
      where: { id: proposalId },
      include: {
        reactions: { select: { userId: true, type: true } },
        purchases: { select: { userId: true } },
      },
    }),
    groupUserIds(groupId),
  ]);
  if (!proposal || proposal.status !== "AGREED") return false;

  const required = requiredPurchasers(proposal.reactions, members);
  const bought = new Set(proposal.purchases.map((p) => p.userId));
  if (required.length === 0 || !required.every((id) => bought.has(id))) return false;

  const { count } = await db.groupGameProposal.updateMany({
    where: { id: proposalId, status: "AGREED" },
    data: { status: "ACCEPTED" },
  });
  if (count === 0) return false;

  // 状態はもう ACCEPTED にしてあるので、外部の取得で落ちてもゲームは作る（カバーは提案のもの、ジャンル等は空）
  const { headerImage, ...external } = await getOrFetchExternalGameData(proposal.steamAppId, proposal.title).catch(
    () => ({ headerImage: null })
  );
  let addedGameId: string | null = null;
  try {
    const created = await db.groupGame.create({
      data: {
        groupId,
        steamAppId: proposal.steamAppId,
        title: proposal.title,
        // 提案時に組み立てた固定パスより、appdetailsが返す正しいURLを優先する
        coverUrl: headerImage ?? proposal.coverUrl,
        ...external,
        status: "WISHLIST", // 画面では「プレイ予定」
        addedById: proposal.proposedById,
      },
    });
    addedGameId = created.id;
  } catch {
    // 先に誰かが手でリストへ足していた場合（groupId × steamAppId の一意制約）。採用扱いのまま進める
  }

  await logActivity({
    kind: "proposal.accepted",
    targetId: proposal.id,
    targetName: proposal.title,
    groupId,
    actorId: proposal.proposedById,
    detail: { purchasedCount: required.length },
  });
  if (addedGameId) {
    await logActivity({
      kind: "game.added",
      targetId: addedGameId,
      targetName: proposal.title,
      groupId,
      actorId: proposal.proposedById,
      detail: { status: "WISHLIST", viaProposal: true },
    });
  }

  await notifyAllPurchased(groupId, proposal.title, required);
  return true;
}

/**
 * 全員が買ってプレイ予定に入ったことを、提案と同じ送り先（`PROPOSAL`）へ知らせる（2026-10-30 ユーザー判断）。
 * 送り先が無ければ何もしない。**失敗してもプレイ予定への追加は戻さない**（もう入っている）。
 * `postDiscordMessage` は例外を投げず false を返すので、戻り値を見てログに残す。
 */
async function notifyAllPurchased(groupId: string, title: string, userIds: string[]) {
  const channelId = await getNotificationChannel(groupId, "PROPOSAL");
  if (!channelId) return;

  // 表示名が無くてもメールアドレスにはフォールバックしない（Discordにメールアドレスを流さない。提案の通知と同じ方針）
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { name: true } });
  const names = users.map((u) => u.name ?? "メンバー").join("、");

  const message = [
    `🎮 **${title}** をやりたい全員が買いました`,
    `ゲームリストの「プレイ予定」に入りました（${names}）`,
  ].join("\n");

  const ok = await postDiscordMessage(channelId, message);
  if (!ok) {
    console.error(`[proposals] Discordへの通知に失敗しました groupId=${groupId} channelId=${channelId}`);
  }
}
