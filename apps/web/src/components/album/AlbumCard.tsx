import Image from "next/image";

type Member = { id: string; name?: string | null; avatarUrl?: string | null };

type AlbumCardProps = {
  title: string;
  coverImageUrl?: string | null;
  coverIsVideo?: boolean;
  photoCount: number;
  members: Member[]; // 表示用（最大4人程度に絞って渡す想定）
  memberCount: number; // 実際の総メンバー数（+N表示に使用）
  /**
   * 「3時間前」のような表示。**サーバーで作った文字列を受け取る**（ここで Date.now() から計算しない）。
   * この部品はクライアント部品（AlbumSearch・ExpandableAlbumGrid）の中で描かれるので、
   * 計算するとサーバーとブラウザで時刻がずれ、分や時間の境目をまたいだ回だけ表示が食い違って
   * React #425/#422 が出ていた（B93 が時々落ちていた原因）
   */
  updatedLabel: string;
  groupName?: string | null; // 指定時、どのグループ所属か分かるバッジを表示（フラットなアルバム一覧向け）
};

export function AlbumCard({
  title,
  coverImageUrl,
  coverIsVideo,
  photoCount,
  members,
  memberCount,
  updatedLabel,
  groupName,
}: AlbumCardProps) {
  const extraMembers = Math.max(memberCount - members.length, 0);

  return (
    <div className="group overflow-hidden rounded-xl bg-steam-surface transition hover:border-steam-blue hover:shadow-[0_0_16px_-2px_rgb(var(--accent)/0.5)]">
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
          <div className="flex h-full w-full items-center justify-center text-2xs text-steam-muted">
            まだ投稿なし
          </div>
        )}
        {photoCount > 0 && (
          <div className="absolute right-1.5 top-1.5 rounded-sm bg-steam-bg/80 px-1.5 py-0.5 font-num text-3xs text-steam-blue">
            {photoCount}
          </div>
        )}
      </div>

      <div className="p-2">
        {groupName && (
          <p className="truncate text-4xs uppercase tracking-wide text-steam-blue/80">
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
                  <div className="flex h-full w-full items-center justify-center text-4xs text-steam-muted">
                    {(m.name ?? "?").slice(0, 1)}
                  </div>
                )}
              </div>
            ))}
            {extraMembers > 0 && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-steam-surface bg-steam-panel text-4xs text-steam-muted">
                +{extraMembers}
              </div>
            )}
          </div>

          <span className="text-3xs text-steam-muted">
            {updatedLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
