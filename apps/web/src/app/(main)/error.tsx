"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { primaryButton, secondaryButton } from "@/components/ui/buttonStyles";

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
    reportClientError(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {/* 見せ方は「まだ何も無い」とき（components/ui/EmptyState.tsx）と揃える。色だけ赤 */}
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/15 text-danger">
        <AlertTriangle size={26} aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-xl font-bold text-steam-text">エラーが発生しました</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-steam-muted">
          予期しない問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className={primaryButton}
        >
          <RotateCw size={16} aria-hidden="true" /> 再試行
        </button>
        <Link
          href="/"
          className={secondaryButton}
        >
          ホームに戻る
        </Link>
      </div>
    </main>
  );
}
