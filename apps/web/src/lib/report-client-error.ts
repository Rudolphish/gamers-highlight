/**
 * エラーバウンダリから /api/errors へ通報する。
 *
 * 監視のための処理が原因で画面がさらに壊れては本末転倒なので、
 * 失敗しても何もしない（結果も見ない）。
 *
 * 本番のサーバー側エラーはNext.jsがメッセージを伏せるため、実質 digest だけが
 * 手掛かりになる。それでも「いつ・どのページで・何回起きたか」は分かるので、
 * Vercelのログを掘る入口としては十分機能する。
 */
export function reportClientError(error: Error & { digest?: string }) {
  try {
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error?.message ?? String(error),
        digest: error?.digest ?? null,
        path: typeof window !== "undefined" ? window.location.pathname : "",
      }),
      keepalive: true, // 直後に離脱されても送り切る
    }).catch(() => {});
  } catch {
    // ignore
  }
}
