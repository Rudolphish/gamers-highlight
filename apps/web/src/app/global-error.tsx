"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkError";
import "./globals.css";
import { primaryButton } from "@/components/ui/buttonStyles";

// ルートレイアウト自体で例外が起きた場合の最終フォールバック（自前でhtml/bodyを持つ必要がある）。
// (main)/error.tsxではカバーできない、レイアウトより上位で起きたエラー用。
// 部品のファイルを読み込めなかったとき（lib/chunkError.ts）は、自動で1回読み直し、ボタンも読み直しにする
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    console.error("[GlobalError]", error);
    reportClientError(error);
    if (isChunkLoadError(error)) reloadOnceForChunkError();
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
            <p className="mx-auto mt-1 max-w-md text-sm text-steam-muted">
              アプリの読み込み中に問題が起きました。再試行してもうまくいかない場合は時間を置いて試してください。
            </p>
          </div>
          <button
            onClick={chunk ? () => window.location.reload() : reset}
            className={primaryButton}
          >
            {chunk ? "再読み込み" : "再試行"}
          </button>
        </main>
      </body>
    </html>
  );
}
