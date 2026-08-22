"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, AlignLeft } from "lucide-react";
import { Lightbox } from "@/components/photo/Lightbox";
import { LoadingImage } from "@/components/ui/LoadingImage";
import { PhotoReactionButton, type ReactionState } from "@/components/photo/PhotoReactionButton";
import type { DescriptionState } from "@/components/photo/PhotoDescription";

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
  /** 渡されたときだけ❤️を出す。/search のように権限が混ざる画面では渡さない */
  reaction?: ReactionState;
  /** 渡されたときだけ説明を扱う。中身はLightboxで出し、グリッドには有無だけ示す */
  description?: DescriptionState;
};

export function PhotoGrid({
  photos,
  currentUserName,
  canEditDescription = false,
}: {
  photos: Media[];
  currentUserName?: string | null;
  /** 説明を書き換えられるか（アルバムのEDITOR以上）。表示は権限に関係なく出る */
  canEditDescription?: boolean;
}) {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // ❤️の数はグリッドとLightboxの両方に出るので、押したときに両方へ反映させる。
  // 元データ（props）は書き換えず、変更があったぶんだけここで上書きする。
  // **名前まで持つこと。** count だけ持つとグリッドで押してからLightboxを開いたときに
  // 「❤️ 1」なのに誰の名前も出ない、という見え方になる
  const [overrides, setOverrides] = useState<Record<string, ReactionState>>({});
  const reactionOf = (item: Media): ReactionState | undefined =>
    item.reaction ? overrides[item.id] ?? item.reaction : undefined;

  // 説明も押した直後に反映させる（元データは書き換えない）
  const [descriptions, setDescriptions] = useState<Record<string, DescriptionState>>({});
  const descriptionOf = (item: Media): DescriptionState | undefined =>
    item.description ? descriptions[item.id] ?? item.description : undefined;

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
            onClick={() => setSelectedIndex(index)}
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
            {descriptionOf(item)?.text && (
              <span
                title="説明あり"
                aria-label="説明あり"
                className="absolute bottom-1 left-1 rounded-sm bg-steam-bg/80 px-1 py-0.5 text-steam-blue"
              >
                <AlignLeft size={10} />
              </span>
            )}
            {item.reaction && (
              <div className="absolute left-1 top-1">
                <PhotoReactionButton
                  photoId={item.id}
                  initial={reactionOf(item)!}
                  currentUserName={currentUserName}
                  onChange={(next) => setOverrides((o) => ({ ...o, [item.id]: next }))}
                />
              </div>
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
          reaction={reactionOf(selectedPhoto)}
          currentUserName={currentUserName}
          onReactionChange={(next) =>
            setOverrides((o) => ({ ...o, [selectedPhoto.id]: next }))
          }
          description={descriptionOf(selectedPhoto)}
          canEditDescription={canEditDescription}
          onDescriptionSaved={(next) =>
            setDescriptions((d) => ({ ...d, [selectedPhoto.id]: next }))
          }
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

