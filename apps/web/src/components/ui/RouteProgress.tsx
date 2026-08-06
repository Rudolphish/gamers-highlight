"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Sidebar/Header等の内部リンククリックから、遷移先ページの描画完了までの間
 * 画面上部に進行中バーを表示する。App RouterはPages Router時代のrouter eventsを
 * 公開していないため、リンククリックをdocument全体で拾って開始を検知し、
 * pathname/searchParamsの変化（＝新しいページのレンダリング完了）で終了させる。
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;

      const target = new URL(href, window.location.href);
      const isSamePage =
        target.pathname === window.location.pathname && target.search === window.location.search;
      if (!isSamePage) setVisible(true);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    setVisible(false);
  }, [pathname, searchParams]);

  if (!visible) return null;

  return (
    <div className="fixed left-0 top-0 z-[100] h-0.5 w-full overflow-hidden bg-steam-border/30">
      <div className="h-full w-1/3 animate-route-progress bg-gradient-to-r from-[#4c6b22] to-[#a4d007]" />
    </div>
  );
}
