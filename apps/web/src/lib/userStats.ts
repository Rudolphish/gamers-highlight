import type { GroupRole } from "@prisma/client";
import { db } from "./db";

/** 「最近使っている」と見なす期間。アクティブ率の分子はここに投稿があった人 */
export const ACTIVE_WINDOW_DAYS = 30;

export type UserGroupRef = { id: string; name: string; role: GroupRole };

export type UserActivityRow = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  groups: UserGroupRef[];
  images: number;
  videos: number;
  total: number;
  /** 容量が分かっている分の合計。Discord経由の投稿はsizeBytesを持たないことがある */
  knownBytes: number;
  /** 容量が記録されていない投稿の数（合計の下限であることを示すために出す） */
  unknownSizeCount: number;
  lastPostedAt: Date | null;
};

export type UserActivitySummary = {
  totalUsers: number;
  activeUsers: number;
  neverPosted: number;
  windowDays: number;
};

export const SORT_KEYS = ["posts", "recent", "joined", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function parseSortKey(value: string | undefined): SortKey {
  return (SORT_KEYS as readonly string[]).includes(value ?? "") ? (value as SortKey) : "posts";
}

/**
 * 全ユーザーの所属グループと投稿数を集計する（管理者ページ用）。
 *
 * 投稿数はグループ単位ではなくユーザー単位で数える。知りたいのは
 * 「アプリを使っている人がどれだけいるか」であって、グループごとの内訳ではないため。
 *
 * 並べ替えは取得後にJavaScript側で行う。人数は友人内で使う規模しか想定しておらず、
 * 集計済みの配列を並べ替える方が、DB側で組み立てるより単純に済むため。
 */
export async function getUserActivity(sort: SortKey = "posts"): Promise<{
  rows: UserActivityRow[];
  summary: UserActivitySummary;
}> {
  const [users, byType, totals, noSize] = await Promise.all([
    db.user.findMany({
      include: {
        groupMemberships: { include: { group: { select: { id: true, name: true } } } },
        ownedGroups: { select: { id: true, name: true } },
      },
    }),
    db.photo.groupBy({ by: ["uploaderId", "mediaType"], _count: { _all: true } }),
    db.photo.groupBy({ by: ["uploaderId"], _sum: { sizeBytes: true }, _max: { createdAt: true } }),
    db.photo.groupBy({ by: ["uploaderId"], where: { sizeBytes: null }, _count: { _all: true } }),
  ]);

  const countOf = (userId: string, mediaType: "IMAGE" | "VIDEO") =>
    byType.find((r) => r.uploaderId === userId && r.mediaType === mediaType)?._count._all ?? 0;

  const rows: UserActivityRow[] = users.map((u) => {
    const total = totals.find((r) => r.uploaderId === u.id);
    const images = countOf(u.id, "IMAGE");
    const videos = countOf(u.id, "VIDEO");

    // オーナーはGroupMemberの行を持たないので、所有グループを足して所属とする
    const groups: UserGroupRef[] = [
      ...u.ownedGroups.map((g) => ({ id: g.id, name: g.name, role: "OWNER" as GroupRole })),
      ...u.groupMemberships.map((m) => ({ id: m.group.id, name: m.group.name, role: m.role })),
    ];

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
      groups,
      images,
      videos,
      total: images + videos,
      knownBytes: total?._sum.sizeBytes ?? 0,
      unknownSizeCount: noSize.find((r) => r.uploaderId === u.id)?._count._all ?? 0,
      lastPostedAt: total?._max.createdAt ?? null,
    };
  });

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const summary: UserActivitySummary = {
    totalUsers: rows.length,
    activeUsers: rows.filter((r) => r.lastPostedAt && r.lastPostedAt >= cutoff).length,
    neverPosted: rows.filter((r) => r.total === 0).length,
    windowDays: ACTIVE_WINDOW_DAYS,
  };

  return { rows: sortRows(rows, sort), summary };
}

/** 投稿が無い人は日付を持たないため、どの並び順でも末尾に寄せる */
function sortRows(rows: UserActivityRow[], sort: SortKey): UserActivityRow[] {
  const byTime = (a: Date | null, b: Date | null) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return b.getTime() - a.getTime();
  };

  const sorted = [...rows];
  switch (sort) {
    case "recent":
      sorted.sort((a, b) => byTime(a.lastPostedAt, b.lastPostedAt));
      break;
    case "joined":
      sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      break;
    case "name":
      sorted.sort((a, b) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "ja")
      );
      break;
    case "posts":
    default:
      // 同数なら最近投稿した人を上に（0件同士が登録順で並ぶより見やすい）
      sorted.sort((a, b) => b.total - a.total || byTime(a.lastPostedAt, b.lastPostedAt));
      break;
  }
  return sorted;
}
