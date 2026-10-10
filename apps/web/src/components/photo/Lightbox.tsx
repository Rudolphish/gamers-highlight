"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Trash2, Info } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { PhotoReactionButton, type ReactionState } from "@/components/photo/PhotoReactionButton";
import { PhotoDescription, type DescriptionState } from "@/components/photo/PhotoDescription";
import type { MediaKind } from "@/lib/mediaKind";
import { parseYoutubeUrl } from "@/lib/youtubeLink";

// メディア詳細（拡大表示）。IMAGE / VIDEO / YOUTUBE に対応。
type LightboxProps = {
  photoId?: string;
  mediaType: MediaKind;
  mediaUrl: string;
  canDelete?: boolean;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDeleted?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  meta?: {
    capturedAt?: string | null;
    gameTitle?: string | null;
    uploaderName?: string | null;
    albumTitle?: string | null;
  };
  /** 渡されたときだけ❤️を出す */
  reaction?: ReactionState;
  currentUserName?: string | null;
  onReactionChange?: (next: ReactionState) => void;
  /** 渡されたときだけ説明を出す */
  description?: DescriptionState;
  canEditDescription?: boolean;
  onDescriptionSaved?: (next: DescriptionState) => void;
};

export function Lightbox({
  photoId,
  mediaType,
  mediaUrl,
  canDelete = false,
  onClose,
  onPrev,
  onNext,
  onDeleted,
  hasPrev = true,
  hasNext = true,
  meta,
  reaction,
  currentUserName,
  onReactionChange,
  description,
  canEditDescription = false,
  onDescriptionSaved,
}: LightboxProps) {
  const [loaded, setLoaded] = useState(false);
  // 保存してあるのは watch のURL。埋め込み用は毎回そこから組み立てる
  // （動画IDを別の列に持たせず、URLを正本にしている）
  const youtubeEmbedUrl = mediaType === "YOUTUBE" ? parseYoutubeUrl(mediaUrl)?.embedUrl ?? null : null;
  const [deleting, setDeleting] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  async function handleDelete() {
    if (!photoId) return;
    if (!window.confirm("この写真/動画を削除しますか？元に戻せません")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onDeleted?.();
    } catch {
      setDeleting(false);
    }
  }

  // ── 横に払って送る（スマホ） ────────────────────────────
  //
  // **YouTubeは対象外。** 埋め込みは別オリジンのiframeなので、プレーヤーの上で起きた
  // タッチはこちらに一切届かない。周囲の余白だけ効く状態にすると「効くときと効かないときが
  // ある」になって、かえって分かりにくい。
  //
  // 動画は中央を払えば効く（再生バーの上はブラウザ側が先に取るので、そこだけ競合する）。
  const swipeEnabled = mediaType === "IMAGE" || mediaType === "VIDEO";

  // 指の開始位置と「横に払っていると判断したか」。判断は一度決めたら離すまで変えない
  // ——途中で縦に逸れるたびに追従が切り替わると、指に貼り付いている感じが壊れる
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");
  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState(false);
  // 送るかの判定に使う**実際の**移動量。`dragX` は端で4分の1に縮めた表示用の値なので、
  // それで判定すると端だけ閾値が厳しくなって挙動が変わる
  const rawDx = useRef(0);

  // 送るかどうかの閾値は画面幅の15%。端のときは送らずに戻すだけなので、
  // 追従も4分の1に抑えて「これ以上は無い」を手触りで返す
  const SWIPE_RATIO = 0.15;
  const EDGE_RESISTANCE = 0.25;
  const AXIS_LOCK_PX = 10;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!swipeEnabled || e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY };
      axis.current = "undecided";
      rawDx.current = 0;
      setSettling(false);
      setDragX(0);
    },
    [swipeEnabled]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStart.current;
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      if (axis.current === "undecided") {
        // どちらの向きに払っているかが決まるまでは何もしない。縦のほうが大きければ
        // 以降この指は無視する（説明パネルを縦にスクロールしたいときの邪魔をしない）
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axis.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }
      if (axis.current !== "horizontal") return;

      rawDx.current = dx;
      const atEdge = (dx < 0 && !hasNext) || (dx > 0 && !hasPrev);
      setDragX(atEdge ? dx * EDGE_RESISTANCE : dx);
    },
    [hasNext, hasPrev]
  );

  const handleTouchEnd = useCallback(() => {
    const start = touchStart.current;
    const decided = axis.current;
    touchStart.current = null;
    axis.current = "undecided";
    if (!start || decided === "undecided") return;

    // 縦に払ったと判断した指は何もしない（説明パネルを縦に動かしたいときの邪魔をしない）。
    // **払った直後の click を捨てる処理は要らない。** 背景の上で払っても閉じないことを
    // 確認済み——`touch-pan-y` を入れる前に「閉じる」と見えていたのは、横の払いが
    // ブラウザの「スワイプで戻る」に取られてページごと離れていたため（B108）
    if (decided !== "horizontal") return;

    const threshold = window.innerWidth * SWIPE_RATIO;
    const moved = rawDx.current;
    rawDx.current = 0;
    setSettling(true);
    setDragX(0);

    if (moved <= -threshold && hasNext) onNext?.();
    else if (moved >= threshold && hasPrev) onPrev?.();
  }, [hasNext, hasPrev, onNext, onPrev]);

  // 前へ/次へで写真を切り替えた際、直前の写真の読み込み完了状態を引きずらないようにリセットする
  useEffect(() => {
    setLoaded(false);
    setDragX(0);
    setSettling(false);
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
      // **`touch-pan-y` が無いと、横の払いがブラウザのジェスチャに取られる。**
      // Chromium は横のオーバースクロールを「スワイプで戻る」として扱うので、
      // 画面の左端あたりから右へ払うと**前のページへ遷移してしまう**
      // （実測: 直接開いていたため空のページに飛び、Lightboxごと消えた）。
      // 縦は譲る——説明パネルを縦にスクロールしたいため。
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm ${
        swipeEnabled ? "touch-pan-y" : ""
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* 情報パネル切り替えボタン */}
      {meta && (
        <div className="absolute top-4 left-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMeta((v) => !v);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/80 transition hover:bg-black hover:text-white"
            aria-label="情報を表示"
          >
            <Info size={20} />
          </button>
        </div>
      )}

      {/* 閉じる・削除ボタン */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {canDelete && photoId && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/80 transition hover:bg-[#eb4b4b] hover:text-white disabled:opacity-50"
            aria-label="削除"
          >
            {deleting ? <Spinner size={20} /> : <Trash2 size={20} />}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/80 transition hover:bg-black hover:text-white"
            aria-label="閉じる"
          >
            <X size={20} />
          </button>
        )}
      </div>

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
      {/* **動かすのはメディアの箱だけ。** 外側に付けると矢印ボタンや❤️・情報パネルまで
          一緒にずれて、指を離すまで押せる位置が変わってしまう */}
      <div
        className={`relative flex max-h-[90vh] max-w-[90vw] items-center justify-center overflow-hidden rounded-sm ${
          settling ? "transition-transform duration-200" : ""
        }`}
        style={dragX !== 0 ? { transform: `translateX(${dragX}px)` } : undefined}
      >
        {mediaType === "YOUTUBE" ? (
          // **iframeで埋め込む。** APIキーもクォータも要らない（動画IDだけで組み立てられる）。
          // nocookie ドメインを使うのは、見ただけで視聴履歴のCookieが置かれないようにするため。
          // 動画が消された・非公開になった場合はここがYouTube側のエラー表示になる——
          // こちら側では検知できないので、見つけた人が報告できる導線を別に置く。
          <iframe
            src={youtubeEmbedUrl ?? ""}
            title="YouTube動画"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="aspect-video h-[50vh] max-h-[90vh] w-[90vw] max-w-[1280px] border-0"
          />
        ) : mediaType === "VIDEO" ? (
          // `touch-auto` で動画だけは横のジェスチャを戻す。上の `touch-pan-y` が
          // 効いたままだと**再生バーを横にドラッグしてシークできなくなる**。
          // そのぶん、動画の上を払ったときは送りではなくブラウザ側の操作になる
          <video
            src={mediaUrl}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] touch-auto object-contain"
          />
        ) : (
          <>
            {/* 画像は読み込むまでサイズが分からないため、固定サイズの枠でスピナーを表示しておく */}
            {!loaded && (
              <div className="flex h-[50vh] w-[50vw] items-center justify-center">
                <Spinner size={32} className="text-steam-muted" />
              </div>
            )}
            {/* next/imageのfill/width-heightは既知サイズの箱を前提にするため、この
                「読み込むまでサイズが分からない・ビューポート基準で自然サイズ表示」という
                用途とは相性が悪く、意図的にnext/imageへは移行していない */}
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

      {/* ❤️。メタ情報パネルは右下なので、こちらは左下に置いて重ならないようにする */}
      {reaction && photoId && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-4 z-10 max-w-[16rem] rounded-sm border border-steam-border bg-steam-surface/95 p-2"
        >
          <PhotoReactionButton
            // **key が要る。** 前へ/次へで写真を切り替えてもコンポーネントは使い回されるため、
            // これが無いと前の写真の❤️の状態が残ったまま表示される（切り替えた後だけ壊れる）
            key={photoId}
            photoId={photoId}
            initial={reaction}
            currentUserName={currentUserName}
            showNames
            size="lg"
            onChange={onReactionChange}
          />
        </div>
      )}

      {/* 説明。メタ情報パネルと同じ右側に、その上へ積む */}
      {description && photoId && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute right-4 z-10 w-72 rounded-sm border border-steam-border bg-steam-surface/95 p-3 ${
            meta && showMeta ? "bottom-40" : "bottom-4"
          }`}
        >
          <PhotoDescription
            // ❤️と同じ理由で key が要る。前へ/次へで切り替えてもコンポーネントは
            // 使い回されるので、これが無いと前の写真の説明が残ったまま表示される
            key={photoId}
            photoId={photoId}
            initial={description}
            canEdit={canEditDescription}
            onSaved={onDescriptionSaved}
          />
        </div>
      )}

      {/* メタ情報サイドパネル */}
      {meta && showMeta && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 right-4 z-10 w-64 space-y-2 rounded-sm border border-steam-border bg-steam-surface/95 p-3 font-mono text-xs text-steam-text"
        >
          <p>
            <span className="text-steam-muted">撮影日: </span>
            {meta.capturedAt ? new Date(meta.capturedAt).toLocaleDateString("ja-JP") : "-"}
          </p>
          <p>
            <span className="text-steam-muted">ゲーム: </span>
            {meta.gameTitle ?? "-"}
          </p>
          <p>
            <span className="text-steam-muted">投稿者: </span>
            {meta.uploaderName ?? "-"}
          </p>
          <p>
            <span className="text-steam-muted">アルバム: </span>
            {meta.albumTitle ?? "-"}
          </p>
        </div>
      )}
    </div>
  );
}

