"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { LogIn, UserPlus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * 招待リンクからの参加ボタン。
 *
 * 未ログインの場合は、Discordへ飛ぶ前にトークンをCookieへ預ける（/api/invites/:token/claim）。
 * OAuthのリダイレクトを跨いで「どのリンク経由だったか」を運ぶ必要があり、
 * それが無いとログイン時に許可リストへの登録を代行できないため。
 *
 * ログイン後は同じページに戻り、そこで加入ボタンを押す形にしている。
 * 読み込みだけで加入させないのは、リンクを開いた時点と参加の意思表示を分けるため。
 */
export function InviteAccept({
  token,
  groupId,
  groupName,
  signedIn,
}: {
  token: string;
  groupId: string;
  groupName: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function loginAndJoin() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}/claim`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "このリンクは使えません");
      }
      // ログイン後は同じ招待ページへ戻す
      await signIn("discord", { callbackUrl: `/invite/${token}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
      setPending(false);
    }
  }

  async function join() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "参加できませんでした");

      setDone(data.alreadyMember ? "既にこのグループのメンバーです。" : "参加しました。");
      router.push(`/groups/${groupId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加できませんでした");
      setPending(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {signedIn ? (
        <button
          onClick={join}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {pending ? <Spinner size={14} /> : <UserPlus size={15} />}
          {groupName}に参加する
        </button>
      ) : (
        <button
          onClick={loginAndJoin}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-sm bg-[#5865F2] px-4 py-2.5 font-mono text-sm font-bold text-white disabled:opacity-40"
        >
          {pending ? <Spinner size={14} /> : <LogIn size={15} />}
          Discordでログインして参加
        </button>
      )}

      {done && <p className="font-mono text-3xs text-[#a4d007]">{done}</p>}
      {error && <p className="font-mono text-3xs text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
