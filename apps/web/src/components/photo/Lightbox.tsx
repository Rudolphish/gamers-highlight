"use client";

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// メディア詳細（拡大表示）。IMAGE/VIDEO両対応。将来的にコメント機能もここに追加予定。
type LightboxProps = {
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
};

export function Lightbox({
  mediaType,
  mediaUrl,
  onClose,
  onPrev,
  onNext,
  hasPrev = true,
  hasNext = true,
}: LightboxProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose?.();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        onPrev?.();
      } else if (e.key === "ArrowRight" && hasNext) {
        onNext?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      {/* 閉じるボタン */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white/80 hover:bg-black hover:text-white transition"
          aria-label="閉じる"
        >
          <X size={20} />
        </button>
      )}

      {/* 前へボタン */}
      {onPrev && (
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="absolute left-4 z-10 rounded-full bg-black/60 p-2 text-white/80 hover:bg-black hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition"
          aria-label="前の写真"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* メディアコンテンツ */}
      <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-sm">
        {mediaType === "VIDEO" ? (
          <video
            src={mediaUrl}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : (
          <img src={mediaUrl} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
        )}
      </div>

      {/* 次へボタン */}
      {onNext && (
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="absolute right-4 z-10 rounded-full bg-black/60 p-2 text-white/80 hover:bg-black hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition"
          aria-label="次の写真"
        >
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  );
}

