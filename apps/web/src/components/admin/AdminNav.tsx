"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "使用量" },
  { href: "/admin/users", label: "ユーザー" },
  { href: "/admin/weekly", label: "週次まとめ" },
  { href: "/admin/activity", label: "活動カレンダー" },
  { href: "/admin/invites", label: "招待リンク" },
  { href: "/admin/media", label: "メディア一覧" },
  { href: "/admin/errors", label: "エラー" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="mt-4 flex flex-wrap gap-1 border-b border-steam-border">
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
