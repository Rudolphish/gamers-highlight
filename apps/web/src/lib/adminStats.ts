import { db } from "./db";
import { listStoredObjects, storageKeyFromUrl } from "./storage";
import { getDailyUsage, YOUTUBE_DAILY_QUOTA, type DailyUsage } from "./apiUsage";

/**
 * 無料枠の目安。プランを上げた場合は環境変数で上書きできるようにしておく
 * （画面には「使用率」を出すため、分母が実態とずれると誤解のもとになる）。
 */
function limitFromEnv(name: string, fallbackGb: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallbackGb * 1024 ** 3;
}

export type StorageStats = {
  /** STORAGE未設定でバケットを見に行けなかった場合はtrue（下の数値は全てDB由来の推定値） */
  unavailable: boolean;
  objectCount: number;
  totalBytes: number;
  photoBytes: number;
  videoBytes: number;
  /** DBのどのレコードからも参照されていないオブジェクト。過去の削除漏れ */
  orphanCount: number;
  orphanBytes: number;
  limitBytes: number;
};

export type DatabaseStats = { sizeBytes: number; limitBytes: number };

export type MediaCounts = {
  images: number;
  videos: number;
  /** DBが持っているサイズの合計。sizeBytesがnullのレコードは含まれない */
  reportedBytes: number;
  /** sizeBytesが入っていないレコード数（上の合計が過小になる度合い） */
  missingSize: number;
};

export type YoutubeStats = {
  todayUnits: number;
  todayCalls: number;
  dailyQuota: number;
  history: DailyUsage[];
};

/** バケットを列挙し、DBが参照しているキーと突き合わせる */
export async function getStorageStats(): Promise<StorageStats> {
  const limitBytes = limitFromEnv("STORAGE_LIMIT_BYTES", 10);
  const objects = await listStoredObjects();

  if (objects === null) {
    return {
      unavailable: true,
      objectCount: 0,
      totalBytes: 0,
      photoBytes: 0,
      videoBytes: 0,
      orphanCount: 0,
      orphanBytes: 0,
      limitBytes,
    };
  }

  const photos = await db.photo.findMany({ select: { mediaUrl: true, thumbnailUrl: true } });
  const referenced = new Set(
    photos
      .flatMap((p) => [p.mediaUrl, p.thumbnailUrl])
      .map(storageKeyFromUrl)
      .filter((k): k is string => k !== null)
  );

  let totalBytes = 0;
  let photoBytes = 0;
  let videoBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;

  for (const o of objects) {
    totalBytes += o.sizeBytes;
    // アップロード時にプレフィックスを分けてある（lib/storage.ts の createUploadUrl）
    if (o.key.startsWith("videos/")) videoBytes += o.sizeBytes;
    else photoBytes += o.sizeBytes;

    if (!referenced.has(o.key)) {
      orphanCount += 1;
      orphanBytes += o.sizeBytes;
    }
  }

  return {
    unavailable: false,
    objectCount: objects.length,
    totalBytes,
    photoBytes,
    videoBytes,
    orphanCount,
    orphanBytes,
    limitBytes,
  };
}

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const rows = await db.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database()) AS size
  `;
  return {
    sizeBytes: Number(rows[0]?.size ?? 0),
    limitBytes: limitFromEnv("DATABASE_LIMIT_BYTES", 0.5),
  };
}

export async function getMediaCounts(): Promise<MediaCounts> {
  const [images, videos, sum, missingSize] = await Promise.all([
    db.photo.count({ where: { mediaType: "IMAGE" } }),
    db.photo.count({ where: { mediaType: "VIDEO" } }),
    db.photo.aggregate({ _sum: { sizeBytes: true } }),
    db.photo.count({ where: { sizeBytes: null } }),
  ]);

  return {
    images,
    videos,
    reportedBytes: sum._sum.sizeBytes ?? 0,
    missingSize,
  };
}

export async function getYoutubeStats(): Promise<YoutubeStats> {
  const history = await getDailyUsage("youtube", 30);
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = history.find((h) => h.date === today);

  return {
    todayUnits: todayRow?.units ?? 0,
    todayCalls: todayRow?.calls ?? 0,
    dailyQuota: YOUTUBE_DAILY_QUOTA,
    history,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
