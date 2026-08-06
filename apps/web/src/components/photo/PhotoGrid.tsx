"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Lightbox } from "@/components/photo/Lightbox";
import { LoadingImage } from "@/components/ui/LoadingImage";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
};

export function PhotoGrid({ photos }: { photos: Media[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {photos.map((item, index) => (
          <div
            key={item.id}
            onClick={() => {
              setSelectedIndex(index);
              console.log("Selected photo index:", index);
            }}
            className="relative aspect-square overflow-hidden rounded-sm border border-steam-border cursor-pointer hover:border-steam-blue hover:brightness-110 transition"
          >
            {item.mediaType === "VIDEO" && !item.thumbnailUrl ? (
              <video
                src={item.mediaUrl}
                preload="metadata"
                muted
                className="h-full w-full object-cover"
              />
            ) : (
              <LoadingImage
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

      {selectedPhoto && selectedIndex !== null && (
        <Lightbox
          mediaType={selectedPhoto.mediaType}
          mediaUrl={selectedPhoto.mediaUrl}
          onClose={() => setSelectedIndex(null)}
          onPrev={() => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setSelectedIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < photos.length - 1}
        />
      )}
    </>
  );
}

