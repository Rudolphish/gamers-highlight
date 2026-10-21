"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ME_HREF, getSidebarSections, isNavItemActive } from "./navItems";
import { accountInitial } from "./accountInitial";

// PC（768px以上）の左メニュー。名前を常に出す（2026-10 のデザイン刷新）。
// 以前は幅80pxのアイコンだけのレールで、名前はホバーのツールチップにしか無かった。
// 768px未満では出さず、下のタブ（BottomTabs）が受け持つ。640px で切り替えると、幅224pxのメニューで本文が狭くなりすぎる。
//
// 本文は body がスクロールするので、`sticky` で画面に残す。高さを `100dvh` で
// 固定しているのは、親のフレックスに引き伸ばされると sticky が効かないため（B97）。
//
// 項目が画面の高さに収まらないときは `<nav>` の中だけ縦にスクロールさせる。
// 以前はレールの外に出すツールチップが切れるので `overflow-y-auto` を付けられなかったが、
// 名前を中に出す形になってツールチップ自体が無くなった。
//
// アカウントは左下に1つ。押すと「自分」ページ（設定・使い方・ログアウト）へ行く。上のヘッダーは無くした
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const sections = getSidebarSections(session?.user?.isAdmin);
  const name = session?.user?.name ?? session?.user?.email ?? "";
  const meActive = pathname === ME_HREF;

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-56 flex-shrink-0 flex-col bg-steam-rail px-3 py-4 md:flex">
      <Link
        href="/"
        aria-label="ShareStaq ホーム"
        className="mb-3 block rounded-lg px-3 py-1 font-logo text-2xl font-bold tracking-tight text-steam-text"
      >
        Share<span className="text-steam-blue">Staq</span>
      </Link>

      <nav aria-label="メニュー" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {sections.map((items, i) => (
          <div key={i} className={i > 0 ? "mt-3 border-t border-steam-border pt-3" : ""}>
            {items.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition ${
                    active ? "bg-steam-panel font-medium text-white" : "text-steam-muted hover:bg-steam-surface hover:text-steam-text"
                  }`}
                >
                  <item.icon size={18} className={`flex-shrink-0 ${active ? "text-steam-blue" : ""}`} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <Link
        href={ME_HREF}
        aria-current={meActive ? "page" : undefined}
        data-testid="sidebar-account"
        className={`mt-3 flex items-center gap-3 rounded-lg p-2.5 transition ${
          meActive ? "bg-steam-panel" : "bg-steam-surface hover:bg-steam-panel"
        }`}
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-steam-blue text-sm font-bold text-accent-ink">
          {accountInitial(name)}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm text-steam-text">{name || "…"}</span>
          <span className="block text-xs text-steam-muted">アカウント</span>
        </span>
      </Link>
    </aside>
  );
}
