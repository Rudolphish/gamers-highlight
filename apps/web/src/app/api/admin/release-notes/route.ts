import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { findPatchNote } from "@/content/patchNotes";
import { sendReleaseNote } from "@/lib/releaseNotes";

// POST /api/admin/release-notes … パッチノートを、まだ送っていないグループへ送る（管理者のみ）
// body: { version }
//
// 送り先（通知の種類 RELEASE_NOTES）が無いグループには送らない。送れたグループだけを記録するので、
// 失敗したグループはもう一度呼べばそこだけ送り直せる（lib/releaseNotes.ts）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const note = typeof body?.version === "string" ? findPatchNote(body.version) : null;
  if (!note) {
    return NextResponse.json({ error: "その版のパッチノートはありません" }, { status: 400 });
  }

  const result = await sendReleaseNote(note, process.env.NEXTAUTH_URL ?? null);
  return NextResponse.json(result);
}
