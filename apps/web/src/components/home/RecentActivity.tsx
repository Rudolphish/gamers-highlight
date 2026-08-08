import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";

type RecentPhoto = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  createdAt: Date | string;
  albumId?: string | null;
  albumTitle?: string | null;
  uploaderName?: string | null;
};

export function RecentActivity({ photos }: { photos: RecentPhoto[] }) {
  if (photos.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {photos.map((p) => {
        const thumb = (
          <div className="w-32 flex-shrink-0">
            <div className="relative aspect-square overflow-hidden rounded-sm border border-steam-border bg-steam-panel">
              {p.mediaType === "VIDEO" && !p.thumbnailUrl ? (
                <video
                  src={p.mediaUrl}
                  preload="metadata"
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <Image
                  src={p.thumbnailUrl ?? p.mediaUrl}
                  alt=""
                  fill
                  sizes="128px"
                  className="object-cover"
                />
              )}
              {p.mediaType === "VIDEO" && (
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-1 py-0.5 font-mono text-[9px] font-bold text-white">
                  <Play size={8} fill="white" /> {p.durationSeconds ?? "?"}s
                </span>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-steam-muted">
              {p.albumTitle ?? "未分類"}
            </p>
            <p className="truncate font-mono text-[9px] text-steam-muted/60">
              {p.uploaderName ?? "?"} ・ {formatRelativeTime(p.createdAt)}
            </p>
          </div>
        );

        return p.albumId ? (
          <Link key={p.id} href={`/albums/${p.albumId}`}>
            {thumb}
          </Link>
        ) : (
          <div key={p.id}>{thumb}</div>
        );
      })}
    </div>
  );
}
