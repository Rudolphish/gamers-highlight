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
      <AlertTriangle size={40} className="text-[#eb4b4b]" />
      <div>
        <h1 className="font-display text-xl font-bold text-steam-text">エラーが発生しました</h1>
        <p className="mt-1 font-mono text-xs text-steam-muted">
          予期しない問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
        </p>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2 font-mono text-xs font-bold text-[#0e1b12]"
      >
        <RotateCw size={13} /> 再試行
      </button>
    </main>
  );
}
