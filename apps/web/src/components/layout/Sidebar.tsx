"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { getNavGroups, isNavItemActive } from "./navItems";

// PC（640px以上）のアイコンレール。**640px未満では出さない**——ラベルが hover の
// ツールチップしか無く、タッチ端末では何のアイコンか知る手段が無いため。
// 細い画面は `MobileNav` のドロワーが受け持つ（項目の定義は `navItems.ts` で共通）。
//
// 本文は body がスクロールするので、`sticky` で画面に残す。高さを `100dvh` で
// 固定しているのは、親のフレックスに引き伸ばされると sticky が効かないため。
//
// **`<nav>` に `overflow-y-auto` を付けてはいけない。** `overflow-y: auto` は
// `overflow-x` も `auto` にするので、レールの外（`absolute left-full`）に出る
// ツールチップが切り取られる（実測: `scrollWidth 202 > clientWidth 84`）。
// `opacity` も矩形も「出ている」と答えるのに画面には無い、という壊れ方をするので、
// `browser.mjs` の B98 が **実際にその位置に居るか**を見ている。
// PC幅でアイコンの名前を知る手段はこのツールチップだけで、切れると何も分からなくなる。
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const navGroups = getNavGroups(session?.user?.isAdmin);

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-20 flex-shrink-0 flex-col border-r border-steam-border bg-steam-panel py-4 sm:flex">
      <div className="mb-6 flex items-center justify-center px-2">
        <Link
          href="/"
          aria-label="ShareStaq ホーム"
          className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-steam-border/50 bg-gradient-to-br from-steam-blue/20 to-steam-panel shadow-lg shadow-steam-blue/10 hover:border-steam-blue transition"
        >
          <span className="font-display text-sm font-black tracking-tight text-steam-blue">SS</span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 px-1">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="px-2 text-3xs uppercase tracking-[0.3em] text-steam-muted">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center justify-center rounded-sm px-2.5 py-2 font-mono text-xs ${
                      active ? "bg-steam-surface text-steam-blue" : "text-steam-muted"
                    }`}
                  >
                    <item.icon size={18} />
                    <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-steam-border bg-steam-surface px-2 py-1 text-2xs text-steam-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
