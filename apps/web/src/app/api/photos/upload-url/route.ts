import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { createUploadUrl } from "@/lib/storage";
import { resolveMediaType, maxSizeFor, MAX_VIDEO_DURATION_SECONDS } from "@/lib/media-limits";

// POST /api/photos/upload-url … 署名付きPOSTポリシーだけを発行する。Photoレコードは作らない。
// body: { contentType, sizeBytes?, durationSeconds? }
//
// レコードは実際にオブジェクトが上がった後に POST /api/photos で作る。
// 以前は先にレコードを作ってから署名を返していたため、ストレージへのPOSTが失敗すると
// 「ファイルは無いのにPhotoだけ存在する」状態が残り、404のURLを指したまま
// ホームやアルバムに壊れた画像として出続けていた（電波の悪い場所で普通に起きる）。
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();

  const mediaType = resolveMediaType(body.contentType);
  if (!mediaType) {
    return NextResponse.json({ error: "unsupported content type" }, { status: 400 });
  }

  if (typeof body.sizeBytes === "number" && body.sizeBytes > maxSizeFor(mediaType)) {
    return NextResponse.json(
      { error: `file too large for ${mediaType.toLowerCase()}` },
      { status: 413 }
    );
  }

  if (mediaType === "VIDEO" && body.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return NextResponse.json(
      { error: `video must be ${MAX_VIDEO_DURATION_SECONDS}s or shorter` },
      { status: 413 }
    );
  }

  // 申告サイズは上で上限と突き合わせ済み。それを署名に含めるので、
  // 実際に送られるサイズが申告と違えば署名が一致せずストレージ側で弾かれる。
  const { upload, publicUrl } = await createUploadUrl(
    body.contentType,
    mediaType,
    typeof body.sizeBytes === "number" ? body.sizeBytes : undefined
  );
  return NextResponse.json({ upload, publicUrl }, { status: 201 });
}
