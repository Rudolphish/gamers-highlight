"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ME_HREF, getSidebarSections, isNavItemActive } from "./navItems";
import { accountInitial } from "./accountInitial";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "./sidebarState";

// PC（768px以上）の左メニュー。名前を常に出す（2026-10 のデザイン刷新）。
// 768px未満では出さず、下のタブ（BottomTabs）が受け持つ。640px で切り替えると、幅224pxのメニューで本文が狭くなりすぎる。
//
// **「たたむ」で、アイコンだけの細い列（幅72px）にできる**（本文を広く使いたい人向け。2026-10-21 ユーザー判断）。
// 畳んだかどうかは Cookie に覚え、最初の描画からその形で出す（sidebarState.ts）。初めての人は開いた形。
//
// 本文は body がスクロールするので、`sticky` で画面に残す。高さを `100dvh` で
// 固定しているのは、親のフレックスに引き伸ばされると sticky が効かないため（B97）。
//
// **畳んでいるときは `<nav>` に `overflow-y-auto` を付けない。** 名前はアイコンの右（`absolute left-full`）に
// 吹き出しで出すが、`overflow-y: auto` は `overflow-x` も `auto` にするので、メニューの外に出た吹き出しが切り取られる
// （以前のアイコンだけのレールで実際に起きた。実測: `scrollWidth 202 > clientWidth 84`）。
// 開いているときは名前が中にあって吹き出しが無いので、項目が画面に収まらないときに備えて縦にスクロールさせる。
//
// アカウントは左下に1つ。押すと「自分」ページ（設定・使い方・ログアウト）へ行く。上のヘッダーは無くした
export function Sidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const sections = getSidebarSections(session?.user?.isAdmin);
  const name = session?.user?.name ?? session?.user?.email ?? "";
  const meActive = pathname === ME_HREF;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // 1年覚える。広げたら消す（既定は開いた形なので、持っておく必要が無い）
    document.cookie = next
      ? `${SIDEBAR_COOKIE}=${SIDEBAR_COLLAPSED}; path=/; max-age=31536000; samesite=lax`
      : `${SIDEBAR_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  // 畳んだときの名前の吹き出し。ホバーとキーボードのフォーカスで出す
  const tip = collapsed
    ? "pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-steam-panel px-2.5 py-1 text-sm text-steam-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    : "";

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={`sticky top-0 z-20 hidden h-[100dvh] flex-shrink-0 flex-col bg-steam-rail py-4 transition-[width] duration-200 md:flex ${
        collapsed ? "w-[72px] px-2" : "w-56 px-3"
      }`}
    >
      <div className={`mb-3 flex items-center ${collapsed ? "flex-col gap-2" : "justify-between"}`}>
        <Link
          href="/"
          aria-label="ShareStaq ホーム"
          className={`block rounded-lg py-1 font-logo font-bold tracking-tight text-steam-text ${collapsed ? "px-1 text-lg" : "px-3 text-2xl"}`}
        >
          {collapsed ? (
            <span className="text-steam-blue">SS</span>
          ) : (
            <>
              Share<span className="text-steam-blue">Staq</span>
            </>
          )}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "メニューを広げる" : "メニューをたたむ"}
          aria-expanded={!collapsed}
          title={collapsed ? "メニューを広げる" : "メニューをたたむ"}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-steam-muted transition hover:bg-steam-surface hover:text-steam-text"
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </button>
      </div>

      <nav aria-label="メニュー" className={`flex min-h-0 flex-1 flex-col ${collapsed ? "" : "overflow-y-auto"}`}>
        {sections.map((items, i) => (
          <div key={i} className={i > 0 ? "mt-3 border-t border-steam-border pt-3" : ""}>
            {items.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex h-10 items-center rounded-lg text-sm transition ${
                    collapsed ? "justify-center" : "gap-3 px-3"
                  } ${active ? "bg-steam-panel font-medium text-white" : "text-steam-muted hover:bg-steam-surface hover:text-steam-text"}`}
                >
                  <item.icon size={18} className={`flex-shrink-0 ${active ? "text-steam-blue" : ""}`} aria-hidden="true" />
                  <span className={tip}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <Link
        href={ME_HREF}
        aria-current={meActive ? "page" : undefined}
        aria-label={collapsed ? `${name || "アカウント"}（自分のページ）` : undefined}
        data-testid="sidebar-account"
        className={`group relative mt-3 flex items-center rounded-lg transition ${collapsed ? "justify-center py-2" : "gap-3 p-2.5"} ${
          meActive ? "bg-steam-panel" : collapsed ? "hover:bg-steam-surface" : "bg-steam-surface hover:bg-steam-panel"
        }`}
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-steam-blue text-sm font-bold text-accent-ink">
          {accountInitial(name)}
        </span>
        {collapsed ? (
          <span className={tip}>{name || "アカウント"}</span>
        ) : (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm text-steam-text">{name || "…"}</span>
            <span className="block text-xs text-steam-muted">アカウント</span>
          </span>
        )}
      </Link>
    </aside>
  );
}
