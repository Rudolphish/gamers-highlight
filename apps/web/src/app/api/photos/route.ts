import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { isManagedStorageUrl } from "@/lib/storage";
import { hasAlbumPermission } from "@/lib/permissions";
import { resolveMediaType, maxSizeFor, MAX_VIDEO_DURATION_SECONDS } from "@/lib/media-limits";

// POST /api/photos … アップロード済みのオブジェクトに対してPhotoレコードを作る
// body: { contentType, mediaUrl, sizeBytes?, durationSeconds?, thumbnailUrl?, albumId?, gameTitle?, capturedAt? }

/**
 * 撮影日時（Steamのスクショはファイル名に入っている）。
 * 未来や極端に古い値は誤読とみなして捨てる。無ければnullのままで困らない。
 */
function parseCapturedAt(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  if (date.getFullYear() < 2003) return null;
  return date;
}
//
// mediaUrl は先に POST /api/photos/upload-url で受け取った publicUrl。
// 署名付きPOSTの発行とレコード作成を分けているのは、ストレージへのアップロードが
// 失敗したときにレコードだけが残らないようにするため。以前は先にレコードを作っており、
// 失敗すると404のURLを指したPhotoが残って壊れた画像として出続けていた。
//
// thumbnailUrl は動画の場合のみ使用。クライアント側で1フレーム目 or 任意画像を
// 先にアップロードし、その公開URLをここに渡す想定。
export async function POST(req: Request) {
  const user = await getCurrentUser();
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

  // albumIdもクライアントの申告なので、自分が投稿できるアルバムかを確認する。
  // ここが無いとIDさえ知っていれば他人のアルバムに写真を差し込めてしまう。
  //
  // **判定は hasAlbumPermission に任せる。** 自前で「所有者かアルバムメンバーか」だけを
  // 見ていたため、グループの共有アルバム（所有者が別のメンバー）への投稿が403になっていた。
  // 自動判別が返すアルバムはグループ経由で辿るので、判別が当たるほど失敗するという
  // 分かりにくい壊れ方をしていた。見られるアルバムには投稿できる、で揃える。
  if (body.albumId != null) {
    const allowed = await hasAlbumPermission(body.albumId, user.id, "VIEWER");
    if (!allowed) {
      return NextResponse.json({ error: "invalid albumId" }, { status: 403 });
    }
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
      capturedAt: parseCapturedAt(body.capturedAt),
      source: "MANUAL",
    },
  });

  return NextResponse.json({ photo }, { status: 201 });
}
