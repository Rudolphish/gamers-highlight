// 画面の部品のファイル（`/_next/static/chunks/…`）を読み込めなかったときの立て直し（2026-11-26）。
//
// 2026-11-26、週末ゲーミングのグループ画面で「Loading chunk 9008 failed.」が5秒に3回記録された。
// 最後のデプロイは13日前で、同じコードを手元で組むと同じ名前のファイルができたので、デプロイで消えたのではなく
// **その端末が一時的に取りに行けなかった**（アプリを開き直した瞬間・回線の切り替わりなど）と見ている。
//
// - エラー画面の「再試行」（`reset`）は描き直すだけで、**失敗したファイルを取り直さない**。何度押しても同じエラーになる
//   （3回記録されたのはたぶんこれ）。このエラーのときはページごと読み直す
// - 自動で読み直すのは **1分に1回まで**（sessionStorage に時刻を残す）。ファイルが本当に無い（デプロイのずれ）ときに
//   読み直しが止まらなくならないように。保存できない環境では自動では読み直さない（ボタンは出る）
// - 記録（/admin/errors）と Discord への通知は今までどおり（ユーザー判断。直らないときに気づけるように）

export const CHUNK_RELOAD_KEY = "ss-chunk-reload-at";
/** この間に一度自動で読み直していたら、もう自動では読み直さない */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/** webpack の ChunkLoadError（JS・CSS）か */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === "ChunkLoadError") return true;
  return typeof e.message === "string" && /Loading (CSS )?chunk [\w-]+ failed/i.test(e.message);
}

type ReloadDeps = {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  now: number;
};

/**
 * 1分以内に自動で読み直していなければ、時刻を残してページを読み直す。読み直したら true。
 * 引数は確かめるとき用（lib-checks）。画面からは引数なしで呼ぶ
 */
export function reloadOnceForChunkError(deps?: Partial<ReloadDeps>): boolean {
  try {
    const storage = deps?.storage !== undefined ? deps.storage : typeof window !== "undefined" ? window.sessionStorage : null;
    const reload = deps?.reload ?? (() => window.location.reload());
    const now = deps?.now ?? Date.now();
    if (!storage) return false;
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    reload();
    return true;
  } catch {
    // 保存できない（プライベートブラウズ等）ときは自動では読み直さない。止まらなくなるよりよい
    return false;
  }
}
