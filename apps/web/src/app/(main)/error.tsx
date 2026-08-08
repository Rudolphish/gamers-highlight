"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

// (main)配下のページで予期しない例外が起きた時に表示するフォールバック。
// サイドバー/ヘッダーはlayout.tsx側が保持したまま、ページ本文だけがこれに差し替わる。
export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[MainError]", error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle size={40} className="text-[#eb4b4b]" />
      <div>
        <h1 className="font-display text-xl font-bold text-steam-text">エラーが発生しました</h1>
        <p className="mt-1 font-mono text-xs text-steam-muted">
          予期しない問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2 font-mono text-xs font-bold text-[#0e1b12]"
        >
          <RotateCw size={13} /> 再試行
        </button>
        <Link
          href="/"
          className="rounded-sm border border-steam-border px-4 py-2 font-mono text-xs text-steam-text hover:border-steam-blue"
        >
          ホームに戻る
        </Link>
      </div>
    </main>
  );
}
