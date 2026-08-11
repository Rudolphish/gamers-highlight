"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import "./globals.css";

// ルートレイアウト自体で例外が起きた場合の最終フォールバック（自前でhtml/bodyを持つ必要がある）。
// (main)/error.tsxではカバーできない、レイアウトより上位で起きたエラー用。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
    reportClientError(error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-steam-bg p-6 text-center">
          <div>
            <p className="font-display text-2xl font-black tracking-tight text-steam-text">
              Share<span className="text-steam-blue">Staq</span>
            </p>
            <h1 className="mt-2 font-display text-xl font-bold text-steam-text">
              エラーが発生しました
            </h1>
            <p className="mt-1 font-mono text-xs text-steam-muted">
              アプリの読み込み中に問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
            </p>
          </div>
          <button
            onClick={reset}
            className="rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2 font-mono text-xs font-bold text-[#0e1b12]"
          >
            再試行
          </button>
        </main>
      </body>
    </html>
  );
}
