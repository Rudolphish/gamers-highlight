"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/profile", label: "プロフィール" },
  { href: "/settings/discord", label: "Discord連携" },
  { href: "/settings/channel-mapping", label: "チャンネル連携" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div className="mt-4 flex gap-1 border-b border-steam-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`border-b-2 px-3 py-2 font-mono text-xs ${
              active
                ? "border-steam-blue text-steam-blue"
                : "border-transparent text-steam-muted hover:text-steam-text"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
