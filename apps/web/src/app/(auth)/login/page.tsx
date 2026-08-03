"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

// ログイン画面：OAuth（Discord/Google）ログイン。
// 許可リストに無いアカウントは lib/auth.ts の signIn コールバックで拒否され、
// ?error=AccessDenied 付きでこの画面に戻ってくる。
//
// useSearchParams()を使うコンポーネントはNext.js 14ではSuspenseで
// 包む必要があるため、ロジック部分を別コンポーネントに分離している。
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const denied = error === "AccessDenied";
  const configError = error === "Configuration";
  const oauthCallbackError = error === "OAuthCallback";
  const otherError = error && !denied && !configError && !oauthCallbackError;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Gamer&apos;s Highlight にログイン</h1>
        <p className="mt-2 text-sm text-gray-500">招待されたメンバーのみアクセスできます</p>
      </div>

      {denied && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          このアカウントはまだ招待されていません。管理者に許可リストへの追加を依頼してください。
        </p>
      )}
      {configError && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          ログイン設定に不備があります。Vercel環境変数 `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
          `NEXTAUTH_SECRET` の設定を確認してください。
        </p>
      )}
      {oauthCallbackError && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          OAuth コールバックでエラーが発生しました。Vercel の `NEXTAUTH_URL` を `https://YOUR_DOMAIN` に設定し、 Discord/Google の OAuth リダイレクト
          URI に `https://YOUR_DOMAIN/api/auth/callback/discord` または `https://YOUR_DOMAIN/api/auth/callback/google` を登録してください。
        </p>
      )}
      {otherError && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          ログインでエラーが発生しました（{error}）。環境変数の設定を確認してください。
        </p>
      )}

      <div className="flex flex-col gap-3 min-w-[240px]">
        <button
          onClick={() => signIn("credentials", { callbackUrl: "/", email: "demo@example.com" })}
          className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition"
        >
          ゲスト/デモログイン
        </button>
        <button
          onClick={() => signIn("discord", { callbackUrl: "/" })}
          className="rounded-md bg-[#5865F2] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#4752C4] transition"
        >
          Discordでログイン
        </button>
        <button onClick={() => signIn("google", { callbackUrl: "/" })} className="rounded-md border border-steam-border bg-steam-surface px-6 py-2.5 text-sm font-medium hover:bg-steam-panel transition">
          Googleでログイン
        </button>
      </div>
    </main>
  );
}
