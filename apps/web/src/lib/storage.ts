import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "crypto";
import { maxSizeFor } from "./media-limits";

function getS3Client() {
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return new S3Client({
    region: "auto",
    endpoint: process.env.STORAGE_ENDPOINT,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * クライアントが直接ストレージへPOSTするための署名付きPOSTポリシーを発行する。
 * サーバーをバイナリが経由しないため、画像・動画どちらでもサーバー負荷が増えない。
 * mediaType に応じて保存先プレフィックスを分けておくと、後の集計・ライフサイクル管理がしやすい。
 *
 * 署名付きPUT URLではなくPOSTポリシーを使うのは、content-length-range条件で
 * ストレージ側に実際のファイルサイズ上限を強制させるため。PUT URLだとサイズ制約を
 * 埋め込めず、クライアントが申告するsizeBytesをDB保存時にチェックするだけになり、
 * 実際のアップロード自体は上限を超えても素通りしてしまう。
 */
export async function createUploadUrl(contentType: string, mediaType: "IMAGE" | "VIDEO") {
  const prefix = mediaType === "VIDEO" ? "videos" : "photos";
  const key = `${prefix}/${randomUUID()}`;
  const bucket = process.env.STORAGE_BUCKET;
  const s3 = getS3Client();

  if (!s3 || !bucket) {
    console.warn("[storage] STORAGE credentials not set — returning fallback mock URL");
    return {
      post: null,
      key,
      publicUrl: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80",
    };
  }

  const post = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ["content-length-range", 0, maxSizeFor(mediaType)],
      ["eq", "$Content-Type", contentType],
    ],
    Fields: { "Content-Type": contentType },
    Expires: 300, // 5分で失効
  });
  const publicUrl = `${process.env.STORAGE_PUBLIC_URL || ""}/${key}`;
  return { post, key, publicUrl };
}

/**
 * サムネイル用など、Photoレコードを作らずにオブジェクトだけ置きたい場合の署名付きPOST。
 * createUploadUrlと違いDBには何も書かない。
 */
export async function createThumbnailUploadUrl(contentType: string) {
  return createUploadUrl(contentType, "IMAGE");
}

/**
 * 保存済みの公開URLから、バケット内のオブジェクトキーを復元する。
 * Photoは`mediaUrl`しか持たずキーを別途保存していないため、
 * STORAGE_PUBLIC_URLのプレフィックスを剥がして求める。
 *
 * 自前のストレージ上に無いURL（STORAGE未設定時のモック画像や、
 * Discordの添付URLをそのまま保存したもの）はnullを返し、削除対象から外す。
 */
export function storageKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = process.env.STORAGE_PUBLIC_URL;
  if (!base) return null;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return key.length > 0 ? key : null;
}

/**
 * 公開URLで指定したオブジェクトをストレージから削除する。
 *
 * 失敗しても例外は投げない：呼び出し元はDBのレコードを消し終えた後に呼ぶため、
 * ここで落とすと「削除できていないように見えて実は消えている」状態になる。
 * 消し漏らしはログに残し、後から手で回収できるようにする。
 */
export async function deleteStoredObjects(urls: (string | null | undefined)[]): Promise<void> {
  const bucket = process.env.STORAGE_BUCKET;
  const s3 = getS3Client();
  if (!s3 || !bucket) return;

  const keys = Array.from(
    new Set(urls.map(storageKeyFromUrl).filter((k): k is string => k !== null))
  );

  await Promise.all(
    keys.map(async (Key) => {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
      } catch (e) {
        console.error(`[storage] failed to delete object key=${Key}`, e);
      }
    })
  );
}

/**
 * Discord Botが取得した画像/動画の一時URLをダウンロードし、
 * 永続ストレージへアップロードする（Discordの添付URLは失効するため）。
 * サイズ上限は呼び出し側（ingest route）でDiscordのContent-Lengthを見て事前チェックする想定。
 */
export async function uploadFromUrlToStorage(sourceUrl: string, mediaType: "IMAGE" | "VIDEO") {
  const bucket = process.env.STORAGE_BUCKET;
  const s3 = getS3Client();

  if (!s3 || !bucket) {
    console.warn("[storage] STORAGE credentials not set — returning fallback source URL");
    return { publicUrl: sourceUrl, key: randomUUID(), sizeBytes: 0 };
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`failed to fetch source media: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? (mediaType === "VIDEO" ? "video/mp4" : "image/png");
  const buffer = Buffer.from(await res.arrayBuffer());

  const prefix = mediaType === "VIDEO" ? "videos" : "photos";
  const key = `${prefix}/discord/${randomUUID()}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return { publicUrl: `${process.env.STORAGE_PUBLIC_URL || ""}/${key}`, key, sizeBytes: buffer.byteLength };
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
