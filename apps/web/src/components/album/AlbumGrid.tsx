import { AlbumCard } from "./AlbumCard";

type Album = { id: string; title: string; coverImageId?: string | null };

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {albums.map((album) => (
        <AlbumCard key={album.id} id={album.id} title={album.title} />
      ))}
    </div>
  );
}
