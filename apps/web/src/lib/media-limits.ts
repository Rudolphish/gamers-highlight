// アップロード可能なメディアの制限値。
// フロント(バリデーション)・API Routes・Discord Bot 全てから参照する想定。

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB（2026-09-06に30MBから引き上げ）
export const MAX_VIDEO_DURATION_SECONDS = 120; // 2分（同上。30秒では短すぎるという実運用の声）

/**
 * **長さの制限は、経路によって効き方が違う。**
 *
 * | 経路 | サイズ | 長さ |
 * |---|---|---|
 * | 手動アップロード | 効く（署名に content-length を含めるのでストレージ側でも弾かれる） | 効く（クライアントが測って送る） |
 * | Discord取り込み | 効く | **効かない**（Discordの添付に長さの情報が無く、Bot側で測る手段もない） |
 *
 * 2026-09-06 まではどちらの経路も `durationSeconds` を送っていなかったため、
 * **長さの制限は実際には一度も効いていなかった**（値だけがコードとドキュメントにあった）。
 * 手動アップロード側は同日に測って送るようにしたので、いまは宣言どおりに効く。
 *
 * **Discord側は引き続きサイズだけで守る。** Discordの添付上限（無料10MB、Nitroでも50MB程度）が
 * 実質の上限になるので、ここに時間の判定を足しても得るものが少ない。
 */

/**
 * 画面に出す文言。制限値を変えたときに画面のテキストだけ古いまま残るのを防ぐため、
 * 数値からその場で組み立てる（実際に30MB・30秒の表記が3ファイルに散っていた）。
 */
export const MEDIA_LIMIT_LABELS = {
  imageSize: `${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB`,
  videoSize: `${MAX_VIDEO_SIZE_BYTES / 1024 / 1024}MB`,
  videoDuration:
    MAX_VIDEO_DURATION_SECONDS % 60 === 0
      ? `${MAX_VIDEO_DURATION_SECONDS / 60}分`
      : `${MAX_VIDEO_DURATION_SECONDS}秒`,
} as const;

export function resolveMediaType(contentType: string): "IMAGE" | "VIDEO" | null {
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) return "IMAGE";
  if ((ALLOWED_VIDEO_TYPES as readonly string[]).includes(contentType)) return "VIDEO";
  return null;
}

export function maxSizeFor(mediaType: "IMAGE" | "VIDEO"): number {
  return mediaType === "VIDEO" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
}
