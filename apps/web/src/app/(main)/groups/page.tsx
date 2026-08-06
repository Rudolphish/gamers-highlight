import Link from "next/link";
import { Plus, Users, Film } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatRelativeTime } from "@/lib/relative-time";

// グループ一覧画面：自分が所有/参加しているグループ一覧
export default async function GroupsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const user = await db.user.findUnique({ where: { email: session.user.email } });
  if (!user) return null;

  const groups = await db.group.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { albums: true, members: true } },
    },
  });

  return (
    <main className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-wide text-steam-text sm:text-3xl">
          グループ
        </h1>
        <Link
          href="/groups/new"
          className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
        >
          <Plus size={14} /> 新規グループ
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="mt-6 font-mono text-sm text-steam-muted">
          まだグループがありません。作成して仲間を招待しましょう。
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="rounded-sm border border-steam-border bg-steam-surface p-3 transition hover:border-steam-blue"
            >
              <p className="truncate font-display text-base font-semibold text-steam-text">
                {group.name}
              </p>
              <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-steam-muted">
                <span className="flex items-center gap-1">
                  <Film size={11} /> {group._count.albums}
                </span>
                <span className="flex items-center gap-1">
                  <Users size={11} /> {group._count.members + 1}
                </span>
                <span className="ml-auto text-steam-muted/70">
                  {formatRelativeTime(group.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
