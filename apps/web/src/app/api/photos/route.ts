import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagedStorageUrl } from "@/lib/storage";
import { resolveMediaType, maxSizeFor, MAX_VIDEO_DURATION_SECONDS } from "@/lib/media-limits";

// POST /api/photos … アップロード済みのオブジェクトに対してPhotoレコードを作る
// body: { contentType, mediaUrl, sizeBytes?, durationSeconds?, thumbnailUrl?, albumId?, gameTitle? }
//
// mediaUrl は先に POST /api/photos/upload-url で受け取った publicUrl。
// 署名付きPOSTの発行とレコード作成を分けているのは、ストレージへのアップロードが
// 失敗したときにレコードだけが残らないようにするため。以前は先にレコードを作っており、
// 失敗すると404のURLを指したPhotoが残って壊れた画像として出続けていた。
//
// thumbnailUrl は動画の場合のみ使用。クライアント側で1フレーム目 or 任意画像を
// 先にアップロードし、その公開URLをここに渡す想定。
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

  // クライアントの申告をそのまま保存するので、自分たちのストレージ上のURLかを必ず確認する。
  // ここが無いと任意のURLをmediaUrlとして保存できてしまう。
  if (!isManagedStorageUrl(body.mediaUrl)) {
    return NextResponse.json({ error: "invalid mediaUrl" }, { status: 400 });
  }
  if (body.thumbnailUrl != null && !isManagedStorageUrl(body.thumbnailUrl)) {
    return NextResponse.json({ error: "invalid thumbnailUrl" }, { status: 400 });
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

  const photo = await db.photo.create({
    data: {
      mediaType,
      mediaUrl: body.mediaUrl,
      thumbnailUrl: mediaType === "VIDEO" ? body.thumbnailUrl ?? null : null,
      sizeBytes: body.sizeBytes ?? null,
      durationSeconds: mediaType === "VIDEO" ? body.durationSeconds ?? null : null,
      uploaderId: user.id,
      albumId: body.albumId ?? null,
      gameTitle: body.gameTitle ?? null,
      source: "MANUAL",
    },
  });

  return NextResponse.json({ photo }, { status: 201 });
}
