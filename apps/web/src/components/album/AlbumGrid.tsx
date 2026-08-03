import Link from "next/link";
import { AlbumCard } from "./AlbumCard";

type Album = { id: string; title: string; coverImageId?: string | null };

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {albums.map((album) => (
        <Link key={album.id} href={`/albums/${album.id}`}>
          <AlbumCard id={album.id} title={album.title} />
        </Link>
      ))}
    </div>
  );
}
