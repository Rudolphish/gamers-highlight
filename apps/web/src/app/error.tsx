"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { AlertTriangle, RotateCw } from "lucide-react";

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
      <AlertTriangle size={40} className="text-danger" />
      <div>
        <h1 className="font-display text-xl font-bold text-steam-text">エラーが発生しました</h1>
        <p className="mt-1 text-xs text-steam-muted">
          予期しない問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
        </p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-1.5 rounded-sm bg-accent px-4 py-2 text-xs font-bold text-accent-ink"
      >
        <RotateCw size={13} /> 再試行
      </button>
    </main>
  );
}
