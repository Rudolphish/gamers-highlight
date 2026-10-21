"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

// 「自分」ページのログアウト。以前は上のヘッダーのアカウントメニューにあった（ヘッダーは刷新で無くした）
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setPending(true);
        signOut({ callbackUrl: "/" });
      }}
      disabled={pending}
      className="flex h-12 w-full items-center gap-3 rounded-xl bg-steam-surface px-4 text-sm text-danger transition hover:bg-steam-panel disabled:opacity-50"
    >
      {pending ? <Spinner size={18} /> : <LogOut size={18} aria-hidden="true" />}
      <span>{pending ? "ログアウト中…" : "ログアウト"}</span>
    </button>
  );
}
