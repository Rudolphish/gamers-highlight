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
  const otherError = error && !denied;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Gamer's Highlight にログイン</h1>
        <p className="mt-2 text-sm text-gray-500">
          招待されたメンバーのみアクセスできます
        </p>
      </div>

      {denied && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          このアカウントはまだ招待されていません。管理者に許可リストへの追加を依頼してください。
        </p>
      )}
      {otherError && (
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          ログインでエラーが発生しました（{error}）。環境変数の設定を確認してください。
        </p>
      )}

      <div className="flex flex-col gap-3">
        <button
          onClick={() => signIn("discord", { callbackUrl: "/" })}
          className="rounded-md bg-[#5865F2] px-6 py-2.5 text-sm font-medium text-white"
        >
          Discordでログイン
        </button>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="rounded-md border px-6 py-2.5 text-sm font-medium"
        >
          Googleでログイン
        </button>
      </div>
    </main>
  );
}
