import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { createUploadUrl } from "@/lib/storage";
import {
  resolveMediaType,
  maxSizeFor,
  MAX_VIDEO_DURATION_SECONDS,
} from "@/lib/media-limits";

// POST /api/photos … 署名付きアップロードURLを発行し、Photoレコードを先に作る
// クライアントはレスポンスのuploadUrlへ直接PUTする
// body: { contentType, sizeBytes, durationSeconds?, thumbnailUrl?, albumId?, gameTitle? }
// thumbnailUrl は動画の場合のみ使用。クライアント側で1フレーム目 or 任意画像を
// 先に(通常の画像として)アップロードし、その公開URLをここに渡す想定。
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

  const { uploadUrl, publicUrl } = await createUploadUrl(body.contentType, mediaType);

  const photo = await db.photo.create({
    data: {
      mediaType,
      mediaUrl: publicUrl,
      thumbnailUrl: mediaType === "VIDEO" ? body.thumbnailUrl ?? null : null,
      sizeBytes: body.sizeBytes ?? null,
      durationSeconds: mediaType === "VIDEO" ? body.durationSeconds ?? null : null,
      uploaderId: user.id,
      albumId: body.albumId ?? null,
      gameTitle: body.gameTitle ?? null,
      source: "MANUAL",
    },
  });

  return NextResponse.json({ uploadUrl, photo }, { status: 201 });
}
