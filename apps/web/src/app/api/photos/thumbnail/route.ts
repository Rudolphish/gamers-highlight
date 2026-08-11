import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { createThumbnailUploadUrl } from "@/lib/storage";
import { resolveMediaType, MAX_IMAGE_SIZE_BYTES } from "@/lib/media-limits";

// POST /api/photos/thumbnail … 動画のサムネイル画像だけをアップロードするための署名付きPOSTを発行する。
// body: { contentType, sizeBytes? }
//
// /api/photos と違いPhotoレコードを作らない。以前はサムネイルも通常の画像として
// /api/photos に投げてPhotoを作り、URLだけ控えて即DELETEするという流れになっており、
// 「Photoを消してもストレージのオブジェクトは残す」ことが暗黙の前提になっていた。
// そのままだと写真削除時にオブジェクトも消す処理を入れられない（全動画のサムネイルが
// 消えてしまう）ため、レコードを作らない経路を分けた。
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();

  // サムネイルは画像のみ
  if (resolveMediaType(body.contentType) !== "IMAGE") {
    return NextResponse.json({ error: "unsupported content type" }, { status: 400 });
  }

  if (typeof body.sizeBytes === "number" && body.sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json({ error: "file too large for image" }, { status: 413 });
  }

  const { post, publicUrl } = await createThumbnailUploadUrl(body.contentType);
  return NextResponse.json({ post, publicUrl }, { status: 201 });
}
