"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

const TABS = [
  { href: "/settings/profile", label: "プロフィール" },
  { href: "/settings/discord", label: "Discord連携" },
  { href: "/settings/channel-mapping", label: "チャンネル連携" },
];

// 許可リストは管理者だけが操作できるので、タブ自体も管理者にしか出さない
const ADMIN_TABS = [{ href: "/settings/allowlist", label: "許可リスト" }];

export function SettingsNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const tabs = session?.user?.isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;

  return (
    <div className="mt-4 flex flex-wrap gap-1 border-b border-steam-border">
      {tabs.map((tab) => {
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
