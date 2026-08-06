import Link from "next/link";
import { AlbumCard } from "./AlbumCard";

type Member = { id: string; name?: string | null; avatarUrl?: string | null };

type Album = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  coverIsVideo?: boolean;
  photoCount: number;
  members: Member[];
  memberCount: number;
  updatedAt: Date | string;
  groupName?: string | null;
};

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {albums.map((album) => (
        <Link key={album.id} href={`/albums/${album.id}`}>
          <AlbumCard {...album} />
        </Link>
      ))}
    </div>
  );
}
