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

/**
 * 動画の長さ（秒）をメタデータから読む。"use client" 前提。
 *
 * **長さの制限はここでしか測れない。** サーバーは受け取ったファイルの中身を見ないし
 * （ブラウザ→R2へ直接上げるのでバイナリがサーバーを通らない）、Discord取り込みには
 * そもそも長さの情報が無い。2026-09-06 まではこの関数が無く `durationSeconds` を
 * 誰も送っていなかったため、APIに書いてある長さの判定は一度も動いていなかった。
 *
 * **測れないことがある。** ストリーミング用に書き出したwebmなどは duration が
 * Infinity や NaN で返る。その場合は null を返し、呼び出し側は長さの判定を諦める
 * （測れないファイルを弾くと、正常な短い動画まで上げられなくなるため）。
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = URL.createObjectURL(file);

    const finish = (value: number | null) => {
      URL.revokeObjectURL(video.src);
      resolve(value);
    };

    video.onloadedmetadata = () => {
      const d = video.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    // 読めなかった場合も止めない：本体のアップロードは別の経路で失敗を拾える
    video.onerror = () => finish(null);
  });
}
