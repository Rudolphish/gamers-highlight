"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

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
  const [loaded, setLoaded] = useState(false);

  // 前へ/次へで写真を切り替えた際、直前の写真の読み込み完了状態を引きずらないようにリセットする
  useEffect(() => {
    setLoaded(false);
  }, [mediaUrl]);

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
      <div className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center overflow-hidden rounded-sm">
        {mediaType === "VIDEO" ? (
          <video
            src={mediaUrl}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : (
          <>
            {/* 画像は読み込むまでサイズが分からないため、固定サイズの枠でスピナーを表示しておく */}
            {!loaded && (
              <div className="flex h-[50vh] w-[50vw] items-center justify-center">
                <Spinner size={32} className="text-steam-muted" />
              </div>
            )}
            <img
              src={mediaUrl}
              alt=""
              onLoad={() => setLoaded(true)}
              className={`max-h-[90vh] max-w-[90vw] object-contain ${loaded ? "" : "hidden"}`}
            />
          </>
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

