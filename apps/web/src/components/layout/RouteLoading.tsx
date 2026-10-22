"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/brand/BrandMark";
import { setNavLoadingPhase, useNavLoadingPhase } from "./navLoading";

// 待ち時間で出し分ける（docs/design/loading.md。ユーザーが候補 A を選んだ）。
// ほとんどの画面移動は0.3秒以内に終わるので、その間は何も出さない（毎回ロゴが一瞬出るとチカチカして遅く感じる）
const SHORT_AFTER_MS = 300;
const LONG_AFTER_MS = 1000;
/** 一度出したら最低これだけは出しておく（すぐ消えるとチラつく） */
const MIN_VISIBLE_MS = 400;
/** 移り先が返ってこないときに、表示だけが残り続けないようにする */
const GIVE_UP_MS = 20000;

/**
 * 画面を移っている間の表示。App Router は移動の開始を知らせる仕組みを公開していないので、
 * 内部リンクのクリックを document 全体で拾って始め、pathname / searchParams が変わったら終える
 * （以前の RouteProgress と同じ判定。上の進行バーもここに引き継いだ）。
 *
 * **Suspense を使わずにブラウザ側だけで判定している**のは、Next.js 15.5 の loading.tsx の不具合を避けるため
 * （navLoading.ts のコメント）
 */
export function RouteLoading() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const phase = useNavLoadingPhase();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shownAt = useRef<number | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const show = (next: "short" | "long") => {
    if (shownAt.current === null) shownAt.current = Date.now();
    setNavLoadingPhase(next);
  };

  const finish = () => {
    clearTimers();
    if (shownAt.current === null) {
      setNavLoadingPhase("idle");
      return;
    }
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
    timers.current.push(
      setTimeout(() => {
        shownAt.current = null;
        setNavLoadingPhase("idle");
      }, wait)
    );
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;

      const target = new URL(href, window.location.href);
      const isSamePage = target.pathname === window.location.pathname && target.search === window.location.search;
      if (isSamePage) return;

      clearTimers();
      timers.current.push(
        setTimeout(() => show("short"), SHORT_AFTER_MS),
        setTimeout(() => show("long"), LONG_AFTER_MS),
        setTimeout(finish, GIVE_UP_MS)
      );
    }
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      clearTimers();
    };
    // show / finish は ref と外のストアしか触らないので、張り直さなくてよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 移り先の描画が終わった（URL が変わった）
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  if (phase === "idle") return null;

  return (
    <>
      <div
        data-testid="route-progress"
        className="fixed left-0 top-0 z-[100] h-0.5 w-full overflow-hidden bg-steam-border/30"
      >
        <div className="h-full w-1/3 animate-route-progress bg-accent" />
      </div>
      {phase === "short" && (
        <span role="status" className="sr-only">
          読み込み中
        </span>
      )}
      {phase === "long" && (
        // 本文の場所だけに重ねる（左メニューと下のタブは押せるまま。位置は globals.css の .route-loading-overlay）
        <div
          role="status"
          data-testid="route-loading"
          className="route-loading-overlay fixed right-0 top-0 z-30 flex flex-col items-center justify-center gap-3 bg-steam-bg/75"
        >
          <BrandMark size={72} animate />
          <span className="font-logo text-2xl font-bold tracking-tight text-steam-text">
            Share<span className="brand-shimmer text-steam-blue">Staq</span>
          </span>
          <span className="text-xs text-steam-muted">読み込み中…</span>
        </div>
      )}
    </>
  );
}
