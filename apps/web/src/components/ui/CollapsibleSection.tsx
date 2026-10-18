"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  defaultOpen = true,
  headerAction,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {/* 見出しの大きさはグループ画面の「最近の動き」（components/group/RecentActivity.tsx）に揃えている（ユーザー判断） */}
        {/* 文字の大きさは見出し（h2）に付ける。ボタンは受け継ぐだけ（ボタンに付けると見出し自体は小さいままになる） */}
        <h2 className="font-display text-xl font-bold text-steam-text">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 transition hover:text-steam-blue"
          >
            <ChevronDown
              size={18}
              className={`flex-shrink-0 text-steam-muted transition-transform ${open ? "" : "-rotate-90"}`}
            />
            {title}
          </button>
        </h2>
        {headerAction}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
