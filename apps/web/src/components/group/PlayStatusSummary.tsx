import Link from "next/link";

type GameStatus = "WISHLIST" | "PLAYING" | "BACKLOG" | "COMPLETED";

type Game = {
  id: string;
  title: string;
  coverUrl: string | null;
  status: GameStatus;
  addedByName: string;
};

// グループ内プレイ状況の可視化：「今誰が何をプレイ中/積んでいるか」を一目で分かるように
// 常時表示するダッシュボード（ステータスフィルタを開かなくても見える）。
// 個人単位ではなくグループ単位のステータスをそのまま使う（roadmap.md Phase 6の設計方針通り）。
export function PlayStatusSummary({ groupId, games }: { groupId: string; games: Game[] }) {
  const playing = games.filter((g) => g.status === "PLAYING");
  const backlog = games.filter((g) => g.status === "BACKLOG");

  if (playing.length === 0 && backlog.length === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatusRow groupId={groupId} label="プレイ中" games={playing} accentClass="text-[#a4d007]" />
      <StatusRow groupId={groupId} label="積みゲー" games={backlog} accentClass="text-[#e0a323]" />
    </div>
  );
}

function StatusRow({
  groupId,
  label,
  games,
  accentClass,
}: {
  groupId: string;
  label: string;
  games: Game[];
  accentClass: string;
}) {
  if (games.length === 0) return null;

  return (
    <div className="rounded-sm border border-steam-border bg-steam-panel p-2">
      <p className={`font-mono text-[10px] font-bold ${accentClass}`}>
        {label}（{games.length}）
      </p>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
        {games.map((g) => (
          <Link
            key={g.id}
            href={`/groups/${groupId}/games/${g.id}`}
            title={`${g.title}（${g.addedByName}）`}
            className="flex-shrink-0 overflow-hidden rounded-sm border border-steam-border transition hover:border-steam-blue"
          >
            {g.coverUrl ? (
              <img src={g.coverUrl} alt={g.title} className="h-12 w-20 object-cover" />
            ) : (
              <div className="flex h-12 w-20 items-center justify-center bg-steam-surface font-mono text-[8px] text-steam-muted">
                {g.title.slice(0, 8)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
