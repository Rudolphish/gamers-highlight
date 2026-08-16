import Link from "next/link";
import Image from "next/image";
import { Images } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";

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

/**
 * アルバムの一覧表示（1行1件）。
 *
 * サムネイル表示は1件あたりが大きく、数十件あると目的のものまで延々スクロールすることになる。
 * 名前で探す前提のときはこちらの方が早い。
 */
export function AlbumRows({ albums }: { albums: Album[] }) {
  return (
    <div className="overflow-hidden rounded-sm border border-steam-border">
      {albums.map((album, i) => (
        <Link
          key={album.id}
          href={`/albums/${album.id}`}
          className={`flex items-center gap-3 bg-steam-surface px-3 py-2 transition hover:bg-steam-panel ${
            i > 0 ? "border-t border-steam-border" : ""
          }`}
        >
          <div className="relative h-9 w-16 flex-shrink-0 overflow-hidden rounded-sm bg-steam-panel">
            {album.coverImageUrl && !album.coverIsVideo ? (
              <Image
                src={album.coverImageUrl}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Images size={13} className="text-steam-muted/50" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-steam-text">{album.title}</p>
            {album.groupName && (
              <p className="truncate font-mono text-4xs text-steam-muted/70">{album.groupName}</p>
            )}
          </div>

          <span className="flex-shrink-0 font-mono text-3xs text-steam-muted">
            {album.photoCount}枚
          </span>
          <span className="hidden flex-shrink-0 font-mono text-4xs text-steam-muted/70 sm:inline">
            {formatRelativeTime(album.updatedAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}
