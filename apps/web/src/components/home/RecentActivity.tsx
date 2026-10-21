import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";
import type { MediaKind } from "@/lib/mediaKind";

type RecentPhoto = {
  id: string;
  mediaType: MediaKind;
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
    // スマホは横に送る1列。PC（1024px以上）は「みんなの動き」の右に置くので、折り返して並べる（2026-10-21）
    <div className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] lg:overflow-visible">
      {photos.map((p) => {
        const thumb = (
          <div className="w-32 flex-shrink-0 lg:w-auto">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-steam-panel">
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
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-accent px-1 py-0.5 text-4xs font-bold text-white">
                  <Play size={8} fill="white" /> {`${p.durationSeconds ?? "?"}s`}
                </span>
              )}
              {p.mediaType === "YOUTUBE" && (
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-[#ff0000] px-1 py-0.5 text-4xs font-bold text-white">
                  <Play size={8} fill="white" /> YouTube
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-3xs text-steam-muted">
              {p.albumTitle ?? "未分類"}
            </p>
            <p className="truncate text-4xs text-steam-muted">
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
