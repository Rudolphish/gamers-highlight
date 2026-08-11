import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";

// DELETE /api/allowlist/:id … 許可リストから外す（管理者のみ）。
// 既にログイン済みのUserレコードやその投稿は消さない。次回以降ログインできなくなるだけ。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!isAdminEmail(adminEmail)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const entry = await db.allowlistEntry.findUnique({ where: { id: params.id } });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 自分自身の登録を消すと次のログインで締め出される。取り返しがつかない
  // （許可リストを直せるのはログインできる管理者だけ）ので止める。
  const self =
    (entry.email !== null && entry.email === adminEmail) ||
    (entry.discordUserId !== null &&
      entry.discordUserId ===
        (await db.user.findUnique({ where: { email: adminEmail! } }))?.discordUserId);
  if (self) {
    return NextResponse.json(
      { error: "自分自身の登録は削除できません（次回ログインできなくなります）" },
      { status: 400 }
    );
  }

  await db.allowlistEntry.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
