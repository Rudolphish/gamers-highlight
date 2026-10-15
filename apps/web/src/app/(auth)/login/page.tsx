"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

// ログイン画面：OAuth（Discord）ログイン。
// 許可リストに無いアカウントは lib/auth.ts の signIn コールバックで拒否され、
// ?error=AccessDenied 付きでこの画面に戻ってくる（他のコードは describeLoginError）。
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

/**
 * NextAuth が `?error=` に付けてくるコードを、**ログインしようとしている本人向けの文言**にする。
 *
 * 以前は環境変数名（`NEXTAUTH_URL` など）や設定手順をそのまま出していた。見るのは
 * 友人のメンバーで、直せるのは管理者だけなので、本人には「次に何をすればいいか」だけを出す。
 * 原因の切り分けに要るコードは小さく添える（管理者に伝えてもらう用。サーバーのログと突き合わせる）。
 *
 * **知らないコードは中身を出さない。** signIn コールバックが例外を投げると、NextAuth は
 * その例外メッセージ（Prisma のエラー文など）をそのまま `?error=` に入れてくる。
 */
function describeLoginError(code: string): { message: string; hint?: string; showCode: boolean } {
  switch (code) {
    case "AccessDenied":
      return {
        message: "このDiscordアカウントは、まだ招待されていません。",
        hint: "招待リンクをもらっている場合は、そのリンクを開き直してからログインしてください。別のDiscordアカウントでログインしていないかも確かめてください。",
        showCode: false,
      };
    // OAuthCallback: Discord から戻ってきたときの確認に失敗した（ログインを始めた画面と戻ってきた画面で
    // ブラウザやアドレスが違う・15分以上かかった・Cookie がブロックされている、のどれかが多い）。
    // Callback / OAuthSignin も同じく「途中で失敗した」として扱う
    case "OAuthCallback":
    case "Callback":
    case "OAuthSignin":
    case "State":
      return {
        message: "ログインの途中で失敗しました。もう一度「Discordでログイン」を押してください。",
        hint: "続く場合は、ブックマークではなくこのページを開き直してから試してください。ログインを始めたのと同じブラウザで最後まで進める必要があります（途中で別のブラウザやDiscordアプリが開いた場合は失敗します）。",
        showCode: true,
      };
    case "Configuration":
      return { message: "ログインの設定に問題があり、いまはログインできません。管理者に連絡してください。", showCode: true };
    default:
      return { message: "ログインに失敗しました。時間をおいて、もう一度試してください。", showCode: false };
  }
}

const KNOWN_CODES = new Set(["AccessDenied", "OAuthCallback", "Callback", "OAuthSignin", "State", "Configuration"]);

function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const described = error ? describeLoginError(error) : null;

  const [provider, setProvider] = useState<"discord" | null>(null);

  function handleSignIn(p: "discord") {
    setProvider(p);
    signIn(p, { callbackUrl: "/" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center text-center">
        <p className="mb-4 font-display text-4xl font-black tracking-tight text-steam-text drop-shadow-[0_0_24px_rgba(102,192,244,0.35)] sm:text-5xl">
          Share<span className="text-steam-blue">Staq</span>
        </p>
        <h1 className="text-2xl font-bold text-steam-text">ログイン</h1>
        <p className="mt-2 text-sm text-steam-muted">招待されたメンバーのみアクセスできます</p>
      </div>

      {described && (
        <div role="alert" className="max-w-sm rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{described.message}</p>
          {described.hint && <p className="mt-1.5 text-xs text-red-600">{described.hint}</p>}
          {/* 管理者が原因を切り分けるためのコード。知らないコード（例外メッセージ）は出さない */}
          {described.showCode && error && KNOWN_CODES.has(error) && (
            <p className="mt-1.5 font-mono text-3xs text-red-500/80">{`エラーコード: ${error}`}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 min-w-[240px]">
        <button
          onClick={() => handleSignIn("discord")}
          disabled={provider !== null}
          className="flex items-center justify-center gap-2 rounded-md bg-[#5865F2] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#4752C4] disabled:opacity-50"
        >
          {provider === "discord" && <Spinner size={14} />}
          {provider === "discord" ? "リダイレクト中…" : "Discordでログイン"}
        </button>
      </div>

      <p className="mt-4 font-mono text-3xs text-steam-muted/60">
        © {new Date().getFullYear()} ShareStaq
      </p>
    </main>
  );
}
