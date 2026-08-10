import Image from "next/image";
import { formatRelativeTime } from "@/lib/relative-time";

type Member = { id: string; name?: string | null; avatarUrl?: string | null };

type AlbumCardProps = {
  title: string;
  coverImageUrl?: string | null;
  coverIsVideo?: boolean;
  photoCount: number;
  members: Member[]; // 表示用（最大4人程度に絞って渡す想定）
  memberCount: number; // 実際の総メンバー数（+N表示に使用）
  updatedAt: Date | string;
  groupName?: string | null; // 指定時、どのグループ所属か分かるバッジを表示（フラットなアルバム一覧向け）
};

export function AlbumCard({
  title,
  coverImageUrl,
  coverIsVideo,
  photoCount,
  members,
  memberCount,
  updatedAt,
  groupName,
}: AlbumCardProps) {
  const extraMembers = Math.max(memberCount - members.length, 0);

  return (
    <div className="group overflow-hidden rounded-sm border border-steam-border bg-steam-surface transition hover:border-steam-blue hover:shadow-[0_0_16px_-2px_rgba(102,192,244,0.5)]">
      <div className="relative h-32 w-full overflow-hidden bg-steam-panel">
        {coverImageUrl ? (
          coverIsVideo ? (
            <video
              src={coverImageUrl}
              preload="metadata"
              muted
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          ) : (
            <Image
              src={coverImageUrl}
              alt={title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition group-hover:scale-105"
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-2xs text-steam-muted/60">
            まだ投稿なし
          </div>
        )}
        {photoCount > 0 && (
          <div className="absolute right-1.5 top-1.5 rounded-sm bg-steam-bg/80 px-1.5 py-0.5 font-mono text-3xs text-steam-blue">
            {photoCount}
          </div>
        )}
      </div>

      <div className="p-2">
        {groupName && (
          <p className="truncate font-mono text-4xs uppercase tracking-wide text-steam-blue/80">
            {groupName}
          </p>
        )}
        <p className="truncate font-display text-base font-semibold text-steam-text">{title}</p>

        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center -space-x-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                title={m.name ?? undefined}
                className="h-5 w-5 overflow-hidden rounded-full border border-steam-surface bg-steam-panel"
              >
                {m.avatarUrl ? (
                  <Image src={m.avatarUrl} alt={m.name ?? ""} width={20} height={20} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-mono text-4xs text-steam-muted">
                    {(m.name ?? "?").slice(0, 1)}
                  </div>
                )}
              </div>
            ))}
            {extraMembers > 0 && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-steam-surface bg-steam-panel font-mono text-4xs text-steam-muted">
                +{extraMembers}
              </div>
            )}
          </div>

          <span className="font-mono text-3xs text-steam-muted/70">
            {formatRelativeTime(updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
