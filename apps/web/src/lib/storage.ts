import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.STORAGE_BUCKET!;

/**
 * クライアントが直接ストレージへPUTするための署名付きURLを発行する。
 * サーバーをバイナリが経由しないため、画像・動画どちらでもサーバー負荷が増えない。
 * mediaType に応じて保存先プレフィックスを分けておくと、後の集計・ライフサイクル管理がしやすい。
 */
export async function createUploadUrl(contentType: string, mediaType: "IMAGE" | "VIDEO") {
  const prefix = mediaType === "VIDEO" ? "videos" : "photos";
  const key = `${prefix}/${randomUUID()}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5分で失効
  const publicUrl = `${process.env.STORAGE_PUBLIC_URL}/${key}`;
  return { uploadUrl, key, publicUrl };
}

/**
 * Discord Botが取得した画像/動画の一時URLをダウンロードし、
 * 永続ストレージへアップロードする（Discordの添付URLは失効するため）。
 * サイズ上限は呼び出し側（ingest route）でDiscordのContent-Lengthを見て事前チェックする想定。
 */
export async function uploadFromUrlToStorage(sourceUrl: string, mediaType: "IMAGE" | "VIDEO") {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`failed to fetch source media: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? (mediaType === "VIDEO" ? "video/mp4" : "image/png");
  const buffer = Buffer.from(await res.arrayBuffer());

  const prefix = mediaType === "VIDEO" ? "videos" : "photos";
  const key = `${prefix}/discord/${randomUUID()}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return { publicUrl: `${process.env.STORAGE_PUBLIC_URL}/${key}`, key, sizeBytes: buffer.byteLength };
}

// 動画のサムネイルはサーバー側で生成しない方針。
// 1) デフォルト：クライアント側で<video>+<canvas>から1フレーム目を抜いて
//    通常の画像アップロードと同じ署名付きURLフローでアップロードする
//    （apps/web/src/lib/video-thumbnail.ts の extractFirstFrame を参照）
// 2) 任意：ユーザーが好きな画像を選んでサムネイルとして指定することも可能
// 3) Discord Bot経由の動画はクライアントを介さないため上記が使えず、
//    thumbnailUrl は null のまま保存される。表示側（PhotoGrid）で
//    thumbnailUrl が無い動画は <video preload="metadata"> をそのまま
//    グリッドに描画し、ブラウザの自動先頭フレーム表示に委ねる。
