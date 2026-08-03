import { Play } from "lucide-react";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

export function PhotoGrid({ photos }: { photos: Media[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {photos.map((item) => (
        <div
          key={item.id}
          className="relative aspect-square overflow-hidden rounded-sm border border-steam-border"
        >
          {item.mediaType === "VIDEO" && !item.thumbnailUrl ? (
            <video
              src={item.mediaUrl}
              preload="metadata"
              muted
              className="h-full w-full object-cover"
            />
          ) : (
            <img
              src={item.thumbnailUrl ?? item.mediaUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
          {item.mediaType === "VIDEO" && (
            <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-1 py-0.5 font-mono text-[9px] font-bold text-white">
              <Play size={8} fill="white" /> {item.durationSeconds ?? "?"}s
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
