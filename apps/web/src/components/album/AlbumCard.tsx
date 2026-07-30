type AlbumCardProps = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
};

export function AlbumCard({ title, coverImageUrl }: AlbumCardProps) {
  return (
    <div className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface">
      {coverImageUrl ? (
        <img src={coverImageUrl} alt={title} className="h-32 w-full object-cover" />
      ) : (
        <div className="h-32 w-full bg-steam-panel" />
      )}
      <p className="truncate p-2 font-display text-base font-semibold text-steam-text">
        {title}
      </p>
    </div>
  );
}
