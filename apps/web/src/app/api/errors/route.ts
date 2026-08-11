import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { recordError } from "@/lib/errorReporting";

// POST /api/errors … 画面のエラーバウンダリから呼ばれる。
// body: { message, digest?, path }
//
// ログインを必須にしているのは、誰でも叩ける口にすると通知チャンネルを
// 外部から埋められてしまうため（このアプリは許可リスト制なので、これで実質メンバー限定になる）。
//
// 返り値は常に202。監視の失敗で画面側の表示を変えたくないので、
// クライアントは結果を見ない。
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    await recordError({
      message: typeof body.message === "string" ? body.message : "",
      digest: typeof body.digest === "string" ? body.digest : null,
      path: typeof body.path === "string" ? body.path : "",
    });
  } catch {
    // 記録できなくても画面側には影響させない
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
