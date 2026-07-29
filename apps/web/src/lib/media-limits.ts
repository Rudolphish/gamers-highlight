// アップロード可能なメディアの制限値。
// フロント(バリデーション)・API Routes・Discord Bot 全てから参照する想定。

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
export const MAX_VIDEO_SIZE_BYTES = 30 * 1024 * 1024; // 30MB（30秒クリップの圧縮後想定上限）
export const MAX_VIDEO_DURATION_SECONDS = 30;

export function resolveMediaType(contentType: string): "IMAGE" | "VIDEO" | null {
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) return "IMAGE";
  if ((ALLOWED_VIDEO_TYPES as readonly string[]).includes(contentType)) return "VIDEO";
  return null;
}

export function maxSizeFor(mediaType: "IMAGE" | "VIDEO"): number {
  return mediaType === "VIDEO" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
}
