"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Lightbox } from "@/components/photo/Lightbox";
import { LoadingImage } from "@/components/ui/LoadingImage";

type Media = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  canDelete?: boolean;
  capturedAt?: string | null;
  gameTitle?: string | null;
  uploaderName?: string | null;
  albumTitle?: string | null;
};

export function PhotoGrid({ photos }: { photos: Media[] }) {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  // メタ情報系のいずれかのpropsが渡されているページ（アルバム詳細）でのみ情報パネルを有効にする
  const hasMeta =
    selectedPhoto !== null &&
    (selectedPhoto.capturedAt !== undefined ||
      selectedPhoto.gameTitle !== undefined ||
      selectedPhoto.uploaderName !== undefined ||
      selectedPhoto.albumTitle !== undefined);

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
            className="relative aspect-square overflow-hidden rounded-sm border border-steam-border cursor-pointer hover:border-steam-blue hover:brightness-110 hover:shadow-[0_0_16px_-2px_rgba(102,192,244,0.5)] transition"
          >
            {item.mediaType === "VIDEO" ? (
              <video
                src={item.mediaUrl}
                poster={item.thumbnailUrl ?? undefined}
                preload="metadata"
                muted
                loop
                className="h-full w-full object-cover"
                onMouseEnter={(e) => e.currentTarget.play()}
                onMouseLeave={(e) => {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = 0;
                }}
              />
            ) : (
              <LoadingImage
                src={item.thumbnailUrl ?? item.mediaUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
            {item.mediaType === "VIDEO" && (
              <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-1 py-0.5 font-mono text-4xs font-bold text-white">
                <Play size={8} fill="white" /> {item.durationSeconds ?? "?"}s
              </span>
            )}
          </div>
        ))}
      </div>

      {selectedPhoto && selectedIndex !== null && (
        <Lightbox
          photoId={selectedPhoto.id}
          mediaType={selectedPhoto.mediaType}
          mediaUrl={selectedPhoto.mediaUrl}
          canDelete={selectedPhoto.canDelete}
          onClose={() => setSelectedIndex(null)}
          onPrev={() => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setSelectedIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
          onDeleted={() => {
            setSelectedIndex(null);
            router.refresh();
          }}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < photos.length - 1}
          meta={
            hasMeta
              ? {
                  capturedAt: selectedPhoto.capturedAt,
                  gameTitle: selectedPhoto.gameTitle,
                  uploaderName: selectedPhoto.uploaderName,
                  albumTitle: selectedPhoto.albumTitle,
                }
              : undefined
          }
        />
      )}
    </>
  );
}

