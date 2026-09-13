"use client";

import { extractFirstFrame, readVideoDuration } from "@/lib/video-thumbnail";
import { MAX_VIDEO_DURATION_SECONDS, MEDIA_LIMIT_LABELS } from "@/lib/media-limits";

// ブラウザから写真・動画・YouTubeのリンクを投稿する手順。
//
// **2つの画面から使う**（`/upload` と、アルバム詳細の「追加」モーダル）。
// 以前はアップロード画面の中に閉じていたが、アルバム詳細からも足せるようにしたときに
// 写すのではなくここへ出した。同じ手順が2つあると、片方だけ直して気づかない
// （カバー画像の方針が3箇所に散っていて1箇所直し忘れた件と同じ形になる）。
//
// **画面ごとに違うのは「何を渡すか」だけ。** 追加先の決め方（アルバムを選ぶのか、
// もう決まっているのか）や、ゲーム名の決め方は呼び出し側の責任。ここは受け取った値で保存する。

/**
 * 署名付きURLでストレージへ実体を送る。
 *
 * **PUTで送る。** R2は署名付きPOSTに対応しておらず、POSTすると501が返る。
 * 501にはCORSヘッダーが付かないので、ブラウザ上はCORSエラーに見える。
 *
 * `upload` が無い場合はストレージ未設定のモック環境（ローカル開発時のフォールバック）。
 * 実際のオブジェクトアップロードは発生せず、既に返ってきているモックURLをそのまま使う。
 */
async function putFileToStorage(upload: { url: string; contentType: string } | null, file: File) {
  if (!upload) return;

  // ストレージは別ドメインなので、CORSで弾かれるとfetch自体が例外になる。
  // 「失敗しました」だけだと原因（CORS設定・署名切れ・容量超過）を切り分けられないため、
  // 応答が取れたときは状態コードと本文を、取れなかったときはCORSの可能性を出す。
  let postRes: Response;
  try {
    postRes = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: file,
    });
  } catch (e) {
    throw new Error(
      `ストレージへ接続できませんでした（CORS設定またはネットワークの可能性）: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  if (!postRes.ok) {
    const detail = (await postRes.text().catch(() => "")).slice(0, 200);
    throw new Error(`ストレージへのアップロードに失敗しました（${postRes.status}）${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * 署名付きURLを受け取ってストレージへ上げるところまで。Photoレコードは作らない。
 * 上げ切ってから作ることで、途中で失敗しても「ファイルが無いのにレコードだけある」
 * 状態にならない（失敗時に残るのは参照されないオブジェクトだけで、画面には出ない）。
 */
export async function uploadToStorage(
  file: File,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const res = await fetch("/api/photos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size, ...extra }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`署名の取得に失敗しました（${res.status}）${detail ? `: ${detail}` : ""}`);
  }
  const { upload, publicUrl } = await res.json();
  await putFileToStorage(upload, file);
  return publicUrl;
}

export async function createPhotoRecord(body: Record<string, unknown>) {
  const res = await fetch("/api/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`投稿の保存に失敗しました（${res.status}）${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()).photo;
}

/** 1ファイルの保存先と付随情報。追加先とゲーム名は呼び出し側が決める */
export type UploadTarget = {
  /** 未指定なら未分類として保存される */
  albumId?: string;
  gameTitle?: string;
  capturedAt?: Date | null;
};

/**
 * 1ファイルぶんの投稿。動画ならサムネイルの生成と長さの測定も行う。
 *
 * **動画の長さはここでしか測れない。** バイナリはサーバーを通らずブラウザからR2へ
 * 直接上がるため、サーバー側は申告された値を見るしかない（サイズと同じ扱い）。
 */
export async function uploadMediaFile(file: File, target: UploadTarget = {}) {
  const isVideo = file.type.startsWith("video/");
  let thumbnailUrl: string | undefined;
  let durationSeconds: number | undefined;

  if (isVideo) {
    // 測れないファイル（duration が Infinity で返るwebmなど）は null が返り、長さの判定は行わない。
    // **秒に丸めてから判定する。** Photo.durationSeconds は Int で、
    // Prismaは小数を弾かず0方向へ切り捨てる（実測: 12.9 → 12）ため、
    // 渡す前にこちらで四捨五入しておく。判定も丸めた値で行うので、
    // 「2分ちょうどのつもりが120.4秒だった」クリップは通る。
    const duration = await readVideoDuration(file);
    if (duration !== null) {
      const rounded = Math.round(duration);
      if (rounded > MAX_VIDEO_DURATION_SECONDS) {
        throw new Error(
          `動画が長すぎます（${rounded}秒）。${MEDIA_LIMIT_LABELS.videoDuration}までの動画にしてください`
        );
      }
      durationSeconds = rounded;
    }

    const thumbBlob = await extractFirstFrame(file);
    const thumbFile = new File([thumbBlob], "thumbnail.jpg", { type: "image/jpeg" });
    thumbnailUrl = await uploadToStorage(thumbFile);
  }

  const mediaUrl = await uploadToStorage(
    file,
    durationSeconds !== undefined ? { durationSeconds } : {}
  );

  return createPhotoRecord({
    contentType: file.type,
    mediaUrl,
    sizeBytes: file.size,
    durationSeconds,
    thumbnailUrl,
    gameTitle: target.gameTitle,
    albumId: target.albumId,
    capturedAt: target.capturedAt?.toISOString(),
  });
}

/**
 * YouTubeの動画を1件追加する。
 * URLの正しさはサーバー側でも見る（ここを通らない経路でも弾けるように）。
 */
export async function addYoutubeMedia(youtubeUrl: string, target: UploadTarget = {}) {
  return createPhotoRecord({
    youtubeUrl,
    albumId: target.albumId,
    gameTitle: target.gameTitle,
  });
}
