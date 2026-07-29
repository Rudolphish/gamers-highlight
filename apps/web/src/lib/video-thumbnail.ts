"use client";

/**
 * 動画ファイルの1フレーム目をcanvasで抽出し、JPEG Blobとして返す。
 * "use client" 前提（DOMのvideo/canvasを使うため、サーバーでは動かない）。
 *
 * 使い方の想定フロー（アップロード画面）：
 *   1. ユーザーが動画ファイルを選択
 *   2. extractFirstFrame(file) でサムネイル用Blobを生成
 *   3. サムネイル画像を通常の画像アップロードと同じ署名付きURLフローでアップロード
 *   4. 動画本体もアップロードし、/api/photos に thumbnailUrl を含めて送信
 *
 * ユーザーが「任意の画像をサムネイルにしたい」場合は、この関数を使わず
 * 選んだ画像ファイルをそのまま同じアップロードフローに流せばよい。
 */
export function extractFirstFrame(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = URL.createObjectURL(file);

    video.onloadeddata = () => {
      // 0秒ちょうどだと真っ黒なフレームになることがあるため、わずかに進めてからキャプチャする
      video.currentTime = Math.min(0.1, video.duration || 0);
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("failed to get canvas context"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error("failed to extract thumbnail blob"));
        },
        "image/jpeg",
        0.85
      );
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("failed to load video for thumbnail extraction"));
    };

    function cleanup() {
      URL.revokeObjectURL(video.src);
    }
  });
}
