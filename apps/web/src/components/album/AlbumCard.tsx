type AlbumCardProps = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
};

export function AlbumCard({ title, coverImageUrl }: AlbumCardProps) {
  return (
    <div className="rounded-lg border p-4">
      {coverImageUrl && <img src={coverImageUrl} alt={title} className="rounded" />}
      <p className="mt-2 font-medium">{title}</p>
    </div>
  );
}
