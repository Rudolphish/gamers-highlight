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
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wide text-steam-muted transition hover:text-steam-text"
        >
          <ChevronDown
            size={14}
            className={`flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {title}
        </button>
        {headerAction}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
