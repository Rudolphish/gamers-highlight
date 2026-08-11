"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { ChevronDown, ChevronUp, LogOut, User } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

export function Header() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [authPending, setAuthPending] = useState(false);

  function handleSignIn() {
    setAuthPending(true);
    signIn();
  }

  function handleSignOut() {
    setAuthPending(true);
    signOut({ callbackUrl: "/" });
  }

  const displayName = session?.user?.name ?? session?.user?.email ?? "ゲスト";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 border-b border-steam-border bg-steam-bg/95 backdrop-blur-lg">
      {/* 本文（main）は最大幅なしの全幅レイアウトなので、ヘッダー側も幅を絞らずに
          同じ左右パディングで揃える。1600px 超のモニタでロゴだけ内側にずれるのを防ぐ。 */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="font-display text-xl font-black tracking-tight text-steam-text sm:text-2xl">
            Share<span className="text-steam-blue">Staq</span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-steam-border bg-steam-surface px-3 py-2 text-xs font-mono text-steam-muted sm:flex">
            {status === "loading" ? "読み込み中..." : "アカウントを管理"}
          </div>

          {session ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-full border border-steam-border bg-steam-panel px-3 py-2 text-sm text-steam-text transition hover:border-steam-blue"
                aria-expanded={isOpen}
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-steam-bg text-sm font-semibold text-steam-blue">
                  {initials || <User size={14} />}
                </span>
                <span className="text-sm font-medium text-steam-text">{displayName}</span>
                {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {isOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-sm border border-steam-border bg-steam-panel p-2 shadow-xl shadow-black/20">
                  <div className="mb-2 rounded-sm bg-steam-bg px-3 py-2 text-sm text-steam-muted">{session.user?.email}</div>
                  <Link
                    href="/settings/discord"
                    className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-steam-text transition hover:bg-steam-surface"
                    onClick={() => setIsOpen(false)}
                  >
                    <User size={16} />
                    <span>アカウント設定</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={authPending}
                    className="mt-1 flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-steam-text transition hover:bg-steam-surface disabled:opacity-50"
                  >
                    {authPending ? <Spinner size={16} /> : <LogOut size={16} />}
                    <span>{authPending ? "サインアウト中…" : "サインアウト"}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={authPending}
              className="flex items-center gap-2 rounded-full border border-steam-border bg-steam-panel px-4 py-2 text-sm font-medium text-steam-text transition hover:border-steam-blue disabled:opacity-50"
            >
              {authPending && <Spinner size={14} />}
              {authPending ? "サインイン中…" : "サインイン"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
