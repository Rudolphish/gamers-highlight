"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { AlertTriangle, RotateCw } from "lucide-react";
import { primaryButton } from "@/components/ui/buttonStyles";

// (main)配下以外（ログイン画面など）で例外が起きた時のフォールバック。
// ルートレイアウト（html/body）はそのまま維持される。
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RootError]", error);
    reportClientError(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-steam-bg p-6 text-center">
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
      <button
        onClick={reset}
        className={primaryButton}
      >
        <RotateCw size={16} aria-hidden="true" /> 再試行
      </button>
    </main>
  );
}
