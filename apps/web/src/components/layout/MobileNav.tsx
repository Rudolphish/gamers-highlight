"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getNavGroups, isNavItemActive } from "./navItems";

// モバイル（640px未満）のナビゲーション。`Sidebar` は `sm` 未満では隠してあり、
// 代わりにこのハンバーガーからオーバーレイで出す。
//
// **アイコンだけのレールを細い画面にそのまま出してはいけない。** サイドバーのラベルは
// hover のツールチップしか無いので、タッチ端末では8個の無印アイコンが横幅の2割を
// 占めるだけで、どの画面に行けるのかを知る手段が画面上に存在しなかった。
//
// フォーカストラップは入れていない。Esc・背景タップ・×・リンク選択の4通りで閉じられる
// ので、開いた直後の位置をドロワー内へ移すだけにしてある。
//
// **オーバーレイは `document.body` へポータルで出す。** このコンポーネントは `Header` の
// 中にあり、`Header` は `backdrop-blur-lg` を持っている。`backdrop-filter` は
// `position: fixed` の包含ブロックになるので、ここで素朴に `fixed inset-0` と書くと
// **ビューポートではなくヘッダーの箱**（実測で高さ74px）に対して広がり、ドロワーが
// ヘッダーの帯の中だけに出る。背景も同じ帯しか覆わないので、本文のリンクが
// そのまま押せてしまう（実際にそうなっていた）。
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const panelRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  // ポータルの行き先（document.body）はサーバー側に無いので、載ってから出す
  const [mounted, setMounted] = useState(false);
  const navGroups = getNavGroups(session?.user?.isAdmin);

  const close = useCallback(() => {
    setOpen(false);
    openButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 遷移したら閉じる。リンクの onClick だけだと、ブラウザの「戻る」で開いたまま復帰する
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    // 背面のスクロールを止める。スクロールしているのは body（ドキュメント）なので
    // body に掛ける（レイアウトの内側 div の `overflow-y-auto` は縦には効いていない。
    // 実測済み——`app/(main)/layout.tsx` のコメント参照）
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);

    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="メニューを開く"
        aria-expanded={open}
        aria-controls="mobile-nav"
        className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-sm border border-steam-border bg-steam-panel text-steam-text transition hover:border-steam-blue sm:hidden"
      >
        <Menu size={20} />
      </button>

      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-40 sm:hidden">
              <div
                aria-hidden="true"
                onClick={close}
                className="absolute inset-0 bg-black/70"
              />

              <div
                id="mobile-nav"
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="ナビゲーション"
                className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-steam-border bg-steam-panel shadow-2xl shadow-black/50 outline-none"
              >
                <div className="flex items-center justify-between border-b border-steam-border px-3 py-2">
                  <span className="px-1 font-display text-lg font-black tracking-tight text-steam-text">
                    Share<span className="text-steam-blue">Staq</span>
                  </span>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="メニューを閉じる"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-steam-muted transition hover:text-steam-text"
                  >
                    <X size={20} />
                  </button>
                </div>

                <nav className="flex-1 overflow-y-auto px-2 py-3">
                  {navGroups.map((group) => (
                    <div key={group.label} className="mb-4 last:mb-0">
                      <p className="px-3 pb-1 text-3xs uppercase tracking-[0.3em] text-steam-muted">
                        {group.label}
                      </p>
                      {group.items.map((item) => {
                        const active = isNavItemActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={`flex min-h-[44px] items-center gap-3 rounded-sm px-3 font-mono text-sm ${
                              active
                                ? "bg-steam-surface text-steam-blue"
                                : "text-steam-text"
                            }`}
                          >
                            <item.icon size={18} className="flex-shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </nav>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
