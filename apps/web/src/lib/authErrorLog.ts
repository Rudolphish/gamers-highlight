import { AsyncLocalStorage } from "node:async_hooks";
import { recordError } from "./errorReporting";

// ログインの失敗の「本当の理由」を /admin/errors（ErrorReport）に残す。lib/auth.ts の logger から呼ぶ。
//
// **画面に出るのは `?error=OAuthCallback` という分類だけ**で、その中身（確認用の Cookie が無い・
// 食い違う・Discord がコードを受け付けない……）は Vercel のログにしか出ない。2026-10-15 に
// 「Mac でだけログインできない」という報告があり、手元からはどれに当たったのか分からなかった。
//
// **ここに来る文は外から作れる。** コールバックのURLは誰でも叩けて、`?error_description=` に書いた
// 文がそのまま例外のメッセージになる。なので
// - 記録する文は**決まった分類の文言だけ**（知らないものは英数字だけに削って短く切る）
// - まとめるキー（fingerprint）は分類だけで作る。文や端末の情報で増やさない
//   （増えると、適当なURLを叩くだけで通知チャンネルを埋められる。同じ分類は30分に1回までしか飛ばない）
// - 端末は User-Agent をそのまま残さず、決まった名前（「Mac / Safari」など）に直す

type Ctx = { userAgent: string | null; pending: Promise<void>[] };
const storage = new AsyncLocalStorage<Ctx>();

/** NextAuth のルートをこれで包む。記録を待ってから返す（返した後のサーバーレスは止まりうるため） */
export async function withAuthErrorContext<T>(req: Request, run: () => Promise<T>): Promise<T> {
  const ctx: Ctx = { userAgent: req.headers.get("user-agent"), pending: [] };
  return storage.run(ctx, async () => {
    try {
      return await run();
    } finally {
      await Promise.allSettled(ctx.pending);
    }
  });
}

const CATEGORIES: { test: RegExp; key: string; label: string }[] = [
  { test: /State cookie was missing/i, key: "state-missing", label: "確認用のCookie（state）が見つからない" },
  { test: /code_verifier cookie was missing/i, key: "pkce-missing", label: "確認用のCookie（PKCE）が見つからない" },
  { test: /state mismatch/i, key: "state-mismatch", label: "確認用のCookie（state）が食い違う（別のログインの途中と混ざった）" },
  { test: /invalid_grant/i, key: "invalid-grant", label: "Discordが認可コードを受け付けない（期限切れ・二重に使われた）" },
  { test: /access_denied/i, key: "access-denied", label: "Discordの許可画面でキャンセルされた" },
  { test: /redirect_uri/i, key: "redirect-uri", label: "リダイレクトURIが一致しない（設定の問題）" },
];

/** 外から作れる文を記録してよい形にする（英数字と最低限の記号だけ・短く） */
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9 _.,:()-]/g, "").slice(0, 80);
}

/** 端末を決まった名前に直す。User-Agent をそのまま残さない */
export function describeDevice(ua: string | null): string {
  if (!ua) return "不明";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "その他";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "その他";
  return `${os} / ${browser}`;
}

function innerMessage(metadata: unknown): { name: string; message: string } {
  const m = metadata as { error?: unknown; message?: unknown; name?: unknown } | undefined;
  const err = (m?.error ?? m) as { message?: unknown; name?: unknown } | undefined;
  return {
    name: typeof err?.name === "string" ? err.name : "Error",
    message: typeof err?.message === "string" ? err.message : typeof m?.message === "string" ? m.message : "",
  };
}

/** 記録するもの。null は記録しない（クライアントからの報告や、ログインと関係の無いもの） */
export function classifyAuthError(code: string, metadata: unknown): { fingerprint: string; message: string } | null {
  // /api/auth/_log 経由でブラウザから届くもの（client: true）は誰でも送れるので記録しない
  if ((metadata as { client?: unknown } | undefined)?.client) return null;
  if (!/^(OAUTH_|SIGNIN_|CALLBACK_)/.test(code)) return null;

  const { name, message } = innerMessage(metadata);
  const hit = CATEGORIES.find((c) => c.test.test(message));
  const reason = hit ? hit.label : `その他（${sanitize(name)}: ${sanitize(message)}）`;
  const key = hit ? hit.key : "other";
  const device = describeDevice(storage.getStore()?.userAgent ?? null);
  return {
    fingerprint: `auth:${code}:${key}`,
    message: `ログイン失敗（${code}）: ${reason} ／ 端末: ${device}`,
  };
}

/** NextAuth の logger.error から呼ぶ。Vercel のログにも従来どおり出す */
export function logAuthError(code: string, metadata: unknown) {
  console.error(`[next-auth][error][${code}]`, metadata);
  const classified = classifyAuthError(code, metadata);
  if (!classified) return;
  const job = recordError({ ...classified, path: "/api/auth (ログイン)" });
  const ctx = storage.getStore();
  if (ctx) ctx.pending.push(job);
}
