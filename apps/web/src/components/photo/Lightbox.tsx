"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Trash2, ChevronUp, ChevronDown, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { PhotoReactionButton, type ReactionState } from "@/components/photo/PhotoReactionButton";
import { PhotoDescription, type DescriptionState } from "@/components/photo/PhotoDescription";
import type { MediaKind } from "@/lib/mediaKind";
import { parseYoutubeUrl } from "@/lib/youtubeLink";
import { iconButton } from "@/components/ui/buttonStyles";

// メディア詳細（拡大表示）。IMAGE / VIDEO / YOUTUBE に対応。
//
// 形（2026-10-22、他の画面のデザインに揃えた。ユーザーが見本の A案を選んだ）:
// - 上に見出しの帯（閉じる・ゲーム名・投稿者と撮影日・何枚目か・削除）。iPhone の時計の帯を避ける
// - ❤️・説明・撮影情報は1つの面にまとめる。スマホは下のシート（つまみで撮影情報まで広げる）、PC は右の列（畳める）
// - ボタンは buttonStyles.ts の形と高さ（スマホ44px・PC36px）、面は角の丸い steam-surface（枠線なし）
//
// **背景タップで閉じる・横に払って送るのは、写真の周りの余白（data-lightbox-backdrop）だけ。**
// シートや右の列の上で払っても送らない（説明を書いている途中で写真が変わると困る）
const PANEL_KEY = "ss-lightbox-panel";
const dateFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
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
  /** 何枚目か（0始まり）と全体の枚数。渡されたときだけ「3 / 12」を出す */
  position?: { index: number; total: number };
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
  position,
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
  // スマホのシートで撮影情報まで広げているか
  const [sheetOpen, setSheetOpen] = useState(false);
  // PC の右の列を出しているか。畳んだら次に開いたときも畳んだまま（この部品は開いてからしか描かないので、
  // サーバーの描画と食い違うことはない。読めない環境では出しておく）
  const [panelShown, setPanelShown] = useState(() => {
    try {
      return window.localStorage.getItem(PANEL_KEY) !== "hidden";
    } catch {
      return true;
    }
  });
  function togglePanel() {
    setPanelShown((v) => {
      try {
        window.localStorage.setItem(PANEL_KEY, v ? "hidden" : "shown");
      } catch {
        // 覚えられないだけ。表示はその場で切り替わる
      }
      return !v;
    });
  }

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
    //
    // **払った直後の click を捨てる処理は入れていない。** 一度入れたが、外しても
    // B99〜B108 が全件通る（＝何も守っていない）うえ、**次の本物のタップまで食べて
    // 背景タップで閉じられなくなった**。`touch-pan-y` を入れる前に「払うと閉じる」と
    // 見えていたのは、横の払いがブラウザの「スワイプで戻る」に取られてページごと
    // 離れていたのが原因だった（B108 はURLまで見てこれを区別する）
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

  // ❤️・説明・撮影情報の面。どれも無い画面（検索など）では出さない
  const hasDetails = Boolean((reaction || description) && photoId) || Boolean(meta);
  const title = meta?.gameTitle ?? meta?.albumTitle ?? null;
  const subtitle = [meta?.uploaderName, meta?.capturedAt ? `${dateFmt.format(new Date(meta.capturedAt))} 撮影` : null]
    .filter(Boolean)
    .join("・");

  // シートのつまみを上に払ったら広げる・下に払ったら畳む（タップでも切り替わる）
  const handleStartY = useRef<number | null>(null);

  const details = (
    <>
      {reaction && photoId && (
        <div onClick={(e) => e.stopPropagation()}>
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
      {description && photoId && (
        <div className="border-t border-steam-border pt-3">
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
    </>
  );

  const metaList = meta && (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-steam-border pt-3 text-sm" data-testid="lightbox-meta">
      <dt className="text-steam-muted">アルバム</dt>
      <dd className="min-w-0 break-words text-steam-text">{meta.albumTitle ?? "-"}</dd>
      <dt className="text-steam-muted">ゲーム</dt>
      <dd className="min-w-0 break-words text-steam-text">{meta.gameTitle ?? "-"}</dd>
      <dt className="text-steam-muted">投稿者</dt>
      <dd className="min-w-0 break-words text-steam-text">{meta.uploaderName ?? "-"}</dd>
      <dt className="text-steam-muted">撮影日</dt>
      <dd className="text-steam-text">{meta.capturedAt ? dateFmt.format(new Date(meta.capturedAt)) : "-"}</dd>
    </dl>
  );

  return (
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} の写真` : "写真"}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 見出しの帯。iPhone のホーム画面アプリは時計の帯の下まで画面が広がる（viewport-fit=cover）ので、その分を空ける */}
        <div className="flex items-center gap-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          {onClose && (
            <button onClick={onClose} className={iconButton} aria-label="閉じる">
              <X size={20} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {title && <p className="truncate text-base font-bold text-white">{title}</p>}
            {subtitle && <p className="truncate text-xs text-steam-muted">{subtitle}</p>}
          </div>
          {position && position.total > 1 && (
            <span className="flex-shrink-0 font-num text-xs text-steam-muted" data-testid="lightbox-position">
              {position.index + 1} / {position.total}
            </span>
          )}
          {canDelete && photoId && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${iconButton} hover:bg-danger/20 hover:text-danger`}
              aria-label="削除"
            >
              {deleting ? <Spinner size={20} /> : <Trash2 size={20} />}
            </button>
          )}
          {hasDetails && (
            <button
              onClick={togglePanel}
              className={`${iconButton} hidden md:inline-flex`}
              aria-label={panelShown ? "情報の列を畳む" : "情報の列を出す"}
              aria-expanded={panelShown}
            >
              {panelShown ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            </button>
          )}
        </div>

        {/* 写真の場所。ここ（とメディアの箱の余白）をタップすると閉じ、横に払うと送る */}
        <div
          data-lightbox-backdrop
          // **`touch-pan-y` が無いと、横の払いがブラウザのジェスチャに取られる。**
          // Chromium は横のオーバースクロールを「スワイプで戻る」として扱うので、
          // 画面の左端あたりから右へ払うと**前のページへ遷移してしまう**
          // （実測: 直接開いていたため空のページに飛び、Lightboxごと消えた）
          className={`relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 ${swipeEnabled ? "touch-pan-y" : ""}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).hasAttribute("data-lightbox-backdrop")) onClose?.();
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* 前へボタン */}
          {onPrev && (
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className={`${iconButton} absolute left-[max(0.75rem,env(safe-area-inset-left))] z-10 disabled:cursor-not-allowed disabled:opacity-20`}
              aria-label="前の写真"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {/* メディアコンテンツ */}
          {/* **動かすのはメディアの箱だけ。** 外側に付けると矢印ボタンまで一緒にずれて、
              指を離すまで押せる位置が変わってしまう。箱は写真の場所いっぱいに広げ、余白のタップも「背景」として扱う
              （写真の大きさに合わせた箱にすると、高さが決まらず max-h の % が効かない） */}
          <div
            data-testid="lightbox-media"
            data-lightbox-backdrop
            className={`relative flex h-full w-full items-center justify-center overflow-hidden ${
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
                className="aspect-video max-h-full w-full max-w-[1280px] rounded-xl border-0"
              />
            ) : mediaType === "VIDEO" ? (
              // `touch-auto` で動画だけは横のジェスチャを戻す。上の `touch-pan-y` が
              // 効いたままだと**再生バーを横にドラッグしてシークできなくなる**。
              // そのぶん、動画の上を払ったときは送りではなくブラウザ側の操作になる
              <video src={mediaUrl} controls autoPlay className="max-h-full max-w-full touch-auto rounded-xl object-contain" />
            ) : (
              <>
                {/* 画像は読み込むまでサイズが分からないため、固定サイズの枠でスピナーを表示しておく */}
                {!loaded && (
                  <div className="flex h-[50%] w-[50%] items-center justify-center">
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
                  className={`max-h-full max-w-full rounded-xl object-contain ${loaded ? "" : "hidden"}`}
                />
              </>
            )}
          </div>

          {/* 次へボタン */}
          {onNext && (
            <button
              onClick={onNext}
              disabled={!hasNext}
              className={`${iconButton} absolute right-[max(0.75rem,env(safe-area-inset-right))] z-10 disabled:cursor-not-allowed disabled:opacity-20`}
              aria-label="次の写真"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>
      </div>

      {/* ❤️・説明・撮影情報。スマホは下のシート、PC は右の列 */}
      {hasDetails && (
        <div
          data-testid="lightbox-details"
          className={`flex max-h-[60dvh] flex-shrink-0 flex-col overflow-y-auto rounded-t-2xl bg-steam-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:max-h-none md:w-80 md:rounded-none md:pb-4 md:pt-4 ${
            panelShown ? "" : "md:hidden"
          }`}
        >
          {/* つまみ（スマホだけ）。撮影情報があるときだけ、タップか上下に払って広げる・畳む */}
          {meta ? (
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              onTouchStart={(e) => {
                handleStartY.current = e.touches[0]?.clientY ?? null;
              }}
              onTouchEnd={(e) => {
                const start = handleStartY.current;
                handleStartY.current = null;
                const end = e.changedTouches[0]?.clientY;
                if (start === null || end === undefined) return;
                if (end - start < -24) setSheetOpen(true);
                else if (end - start > 24) setSheetOpen(false);
              }}
              aria-expanded={sheetOpen}
              aria-label={sheetOpen ? "撮影情報を畳む" : "撮影情報を広げる"}
              className="flex h-11 w-full flex-shrink-0 flex-col items-center justify-center gap-1 text-xs text-steam-muted md:hidden"
            >
              <span className="h-1 w-9 rounded-full bg-steam-border" aria-hidden="true" />
              <span className="flex items-center gap-1">
                {sheetOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                撮影情報
              </span>
            </button>
          ) : (
            <div className="h-3 md:hidden" />
          )}
          <div className="space-y-3">
            {details}
            {/* 撮影情報は PC では常に、スマホではシートを広げたときだけ */}
            {metaList && <div className={sheetOpen ? "" : "hidden md:block"}>{metaList}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
