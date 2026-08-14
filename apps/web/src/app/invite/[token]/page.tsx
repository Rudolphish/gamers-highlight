import Link from "next/link";
import { getServerSession } from "next-auth";
import { AlertTriangle, Users } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  findInviteByToken,
  findInviteReservation,
  validateInvite,
  INVALID_REASON_TEXT,
} from "@/lib/groupInvites";
import { InviteAccept } from "@/components/invite/InviteAccept";

// 招待リンクの受け取りページ。
//
// **未ログインでも開ける必要がある。** middleware.tsのmatcherは「保護するパスの列挙」なので、
// /invite を書かなければ最初から未保護。ここに /invite を足すと機能自体が壊れるので注意。
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await findInviteByToken(params.token);

  const session = await getServerSession(authOptions);
  const currentUser = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;

  // ログインを終えた時点でトークンは1回分消費されている。素直に上限を見ると、
  // 招待された本人が「使用済み」を見せられて加入できなくなるので、本人の分は除外する。
  const reservation =
    invite && currentUser ? await findInviteReservation(invite.id, currentUser.id) : null;
  const result = validateInvite(invite, { reserved: Boolean(reservation) });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-steam-bg p-6">
      <p className="font-display text-2xl font-black tracking-tight text-steam-text">
        Share<span className="text-steam-blue">Staq</span>
      </p>

      <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-6">
        {!result.ok || !invite ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle size={32} className="text-[#eb4b4b]" />
            <h1 className="font-display text-lg font-bold text-steam-text">
              このリンクは使えません
            </h1>
            <p className="font-mono text-xs text-steam-muted">
              {INVALID_REASON_TEXT[result.ok ? "not-found" : result.reason]}
            </p>
            <p className="font-mono text-3xs text-steam-muted/70">
              招待した人に、新しいリンクを発行してもらってください。
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <Users size={32} className="text-steam-blue" />
            <div>
              <h1 className="font-display text-lg font-bold text-steam-text">
                「{invite.group.name}」に招待されています
              </h1>
              <p className="mt-1 font-mono text-xs text-steam-muted">
                {invite.createdBy.name ?? invite.createdBy.email ?? "メンバー"}さんからの招待です
              </p>
            </div>

            <InviteAccept
              token={params.token}
              groupId={invite.groupId}
              groupName={invite.group.name}
              signedIn={Boolean(currentUser)}
            />

            <p className="font-mono text-4xs text-steam-muted/60">
              有効期限: {invite.expiresAt.toLocaleString("ja-JP")}
            </p>
          </div>
        )}
      </div>

      <Link href="/" className="font-mono text-3xs text-steam-muted hover:text-steam-text">
        トップへ
      </Link>
    </main>
  );
}
