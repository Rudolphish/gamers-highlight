"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_ITEMS } from "./navItems";

// スマホ（768px未満）の下のタブ（2026-10 のデザイン刷新）。以前はハンバーガーとドロワーだった。
// 片手で親指が届く位置に、よく行く5か所を常に出す。PCのメニューにあってタブに無い行き先は「自分」ページにまとめてある。
//
// **iPhone のホームバーに重ねない。** 下の余白に `env(safe-area-inset-bottom)` を足す。
// この値は `viewport-fit=cover`（app/layout.tsx の viewport）が無いと常に0になる。
// 本文の最後がタブに隠れないよう、レイアウト側（app/(main)/layout.tsx）で同じ高さぶん下を空けている（B88）。
//
// ヘッダーの中には置かない。`backdrop-filter` を持つ箱の中で `position: fixed` にすると、
// 画面ではなくその箱に対して固定される（CLAUDE.md「画面の骨格」。ドロワーで一度やらかした）
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="タブ"
      data-testid="bottom-tabs"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-steam-border bg-steam-rail pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TAB_ITEMS.map((tab) => {
        const active = tab.matches(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs ${
              active ? "font-bold text-steam-blue" : "text-steam-muted"
            }`}
          >
            {tab.primary ? (
              <span className="-mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg shadow-steam-blue/30">
                <tab.icon size={22} strokeWidth={2.4} aria-hidden="true" />
              </span>
            ) : (
              <tab.icon size={20} aria-hidden="true" />
            )}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
