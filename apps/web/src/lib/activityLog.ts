import { db } from "./db";
import type { Prisma } from "@gamers-highlight/db";

/**
 * 活動ログ。週次まとめと、将来のタイムライン／カレンダーの両方がここを読む。
 * 設計の全文と「なぜこの形か」は docs/activity-log.md にある。
 *
 * **既存の createdAt で数えられるものをここに寄せない。** 写真・アルバム・ゲーム・提案の
 * 「追加」は各テーブルの createdAt で今日から過去も数えられる。ここが埋めるのは
 * createdAt では原理的に無理なもの（ステータス変更・削除・説明の編集）。
 * ただし**追加も記録はする**——タイムラインを1つのクエリで組み立てられるようにするため。
 * 集計でどちらを使うかは読む側の判断（docs/activity-log.md §9）。
 */

/**
 * 記録する出来事の種類。**この表に無い kind を書かない。**
 * 集計側が知らない値を黙って捨てるか「不明」として出すかで揉めるため、
 * 足すときは必ずここと docs/activity-log.md §5 の両方に足す。
 */
export const ACTIVITY_KINDS = [
  "photo.created",
  "photo.deleted",
  "photo.description_set",
  "photo.description_cleared",
  "photo.reaction_added",
  "photo.reaction_removed",
  "album.created",
  "album.deleted",
  "game.added",
  "game.status_changed",
  "game.removed",
  "game.interest_added",
  "game.interest_removed",
  "proposal.created",
  "proposal.voted",
  "proposal.vote_removed",
  "proposal.accepted",
  "proposal.withdrawn",
  "member.joined",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivityInput = {
  kind: ActivityKind;
  targetId: string;
  /** 対象が消えた後も何のことか分かるように控える。アルバム名・ゲーム名など */
  targetName?: string | null;
  /** 非正規化。書き込み時なら分かるので、権限判定から受け取って渡す */
  groupId?: string | null;
  /** 誰が。cronなど人がいない経路では省略する */
  actorId?: string | null;
  /**
   * 実世界でいつ起きたか。カレンダーはこれで並べる。
   * 写真なら capturedAt を渡す（去年撮ったスクショを今日上げたら、去年のその日に置きたい）。
   * 省略時は「今」。
   */
  occurredAt?: Date | null;
  /** 集計と表示に要る分だけ。差分の全列は入れない（監査ログではない） */
  detail?: Prisma.InputJsonValue | null;
};

function toRow(input: ActivityInput) {
  return {
    kind: input.kind,
    targetId: input.targetId,
    targetName: input.targetName ?? null,
    groupId: input.groupId ?? null,
    actorId: input.actorId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
    ...(input.detail == null ? {} : { detail: input.detail }),
  };
}

/**
 * 出来事を1件記録する。
 *
 * **ここで例外を投げない。** ログの書き込みが失敗しても、本体の操作（写真の投稿や
 * ❤️）まで巻き添えで失敗させる価値はない。記録漏れは週次まとめの数字が
 * 1件ずれるだけだが、投稿できない不具合はユーザーに直接刺さる。
 * 失敗は `[activity]` タグでログに出す（HowLongToBeat の失敗と同じ扱い方）。
 *
 * **キャッシュを飛ばさない。** revalidateTag を呼ばないこと。ログのために
 * 写真のキャッシュが飛んだら本末転倒（CLAUDE.md の「❤️をキャッシュに載せない」判断と同じ理由）。
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await db.activityLog.create({ data: toRow(input) });
  } catch (e) {
    console.error("[activity] 記録に失敗しました", input.kind, input.targetId, e);
  }
}

/**
 * 本体の書き込みと同じ往復で記録する。
 *
 * 本番は Vercel → Supabase のネットワーク越しで**1クエリ＝1往復**なので、
 * ログを別に投げると全ての書き込みで往復が1つ増える（docs/perf-cache.md）。
 * `$transaction` に並べればまとめて1往復になる。
 *
 * **こちらは例外を投げる**（本体と同じトランザクションなので、失敗すれば本体ごと戻る）。
 * 巻き添えを避けたい場合は `logActivity` を使う。
 */
export function activityLogCreateArgs(input: ActivityInput) {
  return { data: toRow(input) };
}
