import { db } from "./db";

// ゲーム提案の「提案者ごとの区画」と「その人の中での順位」。
//
// 提案は当初「グループへの候補出し」だったが、実際には**各自のウィッシュリスト**として
// 使われていて、件数が増えると1つの一覧では読めなくなった（友人からの要望）。
// そこで提案者ごとに区画を分け、各区画は既定で5件だけ出す。
//
// **順位はnull許容で、nullは「順位なし」。** 付けていない人の見え方を変えないための既定で、
// 付けていない提案は新しい順で並ぶ。

/** 1区画（提案者1人）に既定で出す件数 */
export const PROPOSALS_PER_PROPOSER = 5;

/**
 * 順位として受け付ける最大値。**表示の上限（5件）とは別物**。
 * 画面が出すプルダウンは1〜5だが、表示件数を増やしたくなったときに
 * 既存のデータが「範囲外」にならないよう、保存できる幅は広めに取ってある。
 */
export const MAX_PROPOSAL_RANK = 99;

export type RankableProposal = {
  id: string;
  rank: number | null;
  /** 作成時刻（エポックミリ秒）。**Dateで持たない**——理由は `compareProposals` の上 */
  createdAt: number;
};

/**
 * 並び順：**順位のあるものが昇順で先、無いものは新しい順であと**。
 *
 * 時刻を `Date` ではなく数値で受けているのは、この値がグループ詳細の
 * `unstable_cache` を通って来るため。キャッシュヒットの回だけ `Date` がISO文字列で返り、
 * `getTime()` が落ちる（`CLAUDE.md` の「unstable_cache は Date を文字列にして返す」）。
 * 呼ぶ側で `new Date(x).getTime()` に直してから渡す約束にして、ここでは数値しか扱わない。
 */
export function compareProposals(a: RankableProposal, b: RankableProposal): number {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return b.createdAt - a.createdAt;
}

export function sortProposals<T extends RankableProposal>(list: T[]): T[] {
  return [...list].sort(compareProposals);
}

export type ProposerSection<T> = {
  proposerId: string;
  proposerName: string;
  /** その人の提案（並べ替え済み・全件）。画面が先頭 `PROPOSALS_PER_PROPOSER` 件だけ出す */
  proposals: T[];
};

/**
 * 提案者ごとに区画へ分ける。**自分の区画が先頭**、残りは最後に提案した人から。
 *
 * 区画は「グループのメンバー」ではなく**提案者**を基準に作る。グループを抜けた人の提案は
 * 残るので、メンバー基準にするとその提案がどの区画にも入らず画面から消える。
 */
export function groupProposalsByProposer<
  T extends RankableProposal & { proposedById: string; proposedByName: string },
>(proposals: T[], currentUserId: string): ProposerSection<T>[] {
  const byProposer = new Map<string, ProposerSection<T>>();

  for (const p of proposals) {
    const section = byProposer.get(p.proposedById);
    if (section) {
      section.proposals.push(p);
    } else {
      byProposer.set(p.proposedById, {
        proposerId: p.proposedById,
        proposerName: p.proposedByName,
        proposals: [p],
      });
    }
  }

  const sections = [...byProposer.values()].map((s) => ({
    ...s,
    proposals: sortProposals(s.proposals),
  }));

  const latestOf = (s: ProposerSection<T>) =>
    Math.max(...s.proposals.map((p) => p.createdAt));

  return sections.sort((a, b) => {
    if (a.proposerId === currentUserId) return -1;
    if (b.proposerId === currentUserId) return 1;
    return latestOf(b) - latestOf(a);
  });
}

/**
 * 提案1件の順位を変え、**その提案者のPENDINGな提案の順位を 1..n に詰め直す**。
 *
 * 順位は「その人の中での並び」なので、歯抜け（1,3,7）や重複を許すと画面と食い違う。
 * 入れたい位置を受け取って、残りをその前後へ押し出す形で詰め直す。
 *
 * **一意制約は張っていない**（`schema.prisma` のコメント参照）。詰め直しは行ごとのUPDATEで、
 * 途中で一時的に同じ番号が並ぶため、制約があると正しい操作でも落ちる。
 *
 * @param rank 1以上の整数なら「その位置へ」、null なら「順位なしに戻す」
 * @returns 変更後の並び（id → 順位）。呼び出し側が画面へ返す
 */
export async function rankProposal({
  groupId,
  proposerId,
  proposalId,
  rank,
}: {
  groupId: string;
  proposerId: string;
  proposalId: string;
  rank: number | null;
}): Promise<{ id: string; rank: number | null }[]> {
  const mine = await db.groupGameProposal.findMany({
    where: { groupId, proposedById: proposerId, status: "PENDING" },
    select: { id: true, rank: true, createdAt: true },
  });

  const sorted = sortProposals(
    mine.map((p) => ({ id: p.id, rank: p.rank, createdAt: p.createdAt.getTime() }))
  );

  // 順位付きの並び（対象を一旦外す）
  const ranked = sorted.filter((p) => p.rank !== null && p.id !== proposalId).map((p) => p.id);

  if (rank !== null) {
    // 指定が件数を超えていたら末尾に置く（プルダウンは1〜5だが、
    // 3件しか提案していない人が5を選んでも「3位」として成立させる）
    const index = Math.min(rank - 1, ranked.length);
    ranked.splice(index, 0, proposalId);
  }

  const nextRank = new Map<string, number | null>();
  for (const p of sorted) nextRank.set(p.id, null);
  ranked.forEach((id, i) => nextRank.set(id, i + 1));

  // **変わる行だけ**を書く。全行を毎回更新すると、1クエリ＝1往復ぶんの待ち時間が
  // 提案の件数だけ積み上がる（docs/perf-cache.md）
  const changed = sorted
    .filter((p) => (nextRank.get(p.id) ?? null) !== p.rank)
    .map((p) => ({ id: p.id, rank: nextRank.get(p.id) ?? null }));

  if (changed.length > 0) {
    await db.$transaction(
      changed.map((c) =>
        db.groupGameProposal.update({ where: { id: c.id }, data: { rank: c.rank } })
      )
    );
  }

  return sorted.map((p) => ({ id: p.id, rank: nextRank.get(p.id) ?? null }));
}
