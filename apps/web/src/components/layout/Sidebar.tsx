"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Film, Upload, Settings } from "lucide-react";

const NAV = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/albums", label: "アルバム", icon: Film },
  { href: "/upload", label: "アップロード", icon: Upload },
  { href: "/settings/discord", label: "設定", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex w-16 flex-shrink-0 flex-col items-center gap-1 border-r border-steam-border bg-steam-panel py-4">
      <div className="mb-4 flex items-center justify-center px-2">
        <div className="h-7 w-7 flex-shrink-0 rounded-sm bg-gradient-to-br from-steam-blue to-[#a4d007]" />
      </div>
      {NAV.map((n) => {
        const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`group relative flex items-center justify-center rounded-sm px-2.5 py-2 font-mono text-xs ${
              active ? "bg-steam-surface text-steam-blue" : "text-steam-muted"
            }`}
          >
            <n.icon size={16} />
            <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-steam-border bg-steam-surface px-2 py-1 text-[11px] text-steam-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              {n.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
