"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, Home, Search, Settings, Upload } from "lucide-react";

const NAV_GROUPS = [
  {
    label: "ナビゲーション",
    items: [
      { href: "/", label: "ホーム", icon: Home },
      { href: "/albums", label: "アルバム", icon: Film },
      { href: "/upload", label: "アップロード", icon: Upload },
    ],
  },
  {
    label: "管理",
    items: [
      { href: "/search", label: "検索", icon: Search },
      { href: "/settings/discord", label: "設定", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-20 flex-shrink-0 flex-col border-r border-steam-border bg-steam-panel py-4">
      <div className="mb-6 flex items-center justify-center px-2">
        <Link href="/" className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-steam-border/50 bg-steam-panel shadow-lg shadow-steam-blue/10 hover:border-steam-blue transition">
          <img
            src="/logo.png"
            alt="Gamer's Highlight Logo"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 px-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="px-2 text-[10px] uppercase tracking-[0.3em] text-steam-muted">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center justify-center rounded-sm px-2.5 py-2 font-mono text-xs ${
                      active ? "bg-steam-surface text-steam-blue" : "text-steam-muted"
                    }`}
                  >
                    <item.icon size={18} />
                    <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-steam-border bg-steam-surface px-2 py-1 text-[11px] text-steam-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
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
