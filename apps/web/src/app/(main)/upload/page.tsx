"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload as UploadIcon, Image as ImageIcon, Film, X, Check, AlertCircle } from "lucide-react";
import { extractFirstFrame } from "@/lib/video-thumbnail";

// アップロード画面：画像 or 30秒以内の動画クリップを複数まとめてアップロード可能。
//
// 1ファイルごとの流れ：
//   1. contentTypeで画像/動画を判定
//   2. 動画の場合、まず1フレーム目をcanvasで抽出してサムネイル画像を作る
//   3. サムネイル(動画の場合のみ)→本体の順で、それぞれ署名付きPOSTポリシーを取得してR2へ直接POST
//
// 複数ファイルは「同時並列」ではなく「順番に1つずつ」処理する。
// R2への署名付きURL発行APIを一度に大量に叩かないようにするための安全策で、
// 代わりに各ファイルの進捗を1つずつUIに反映できる利点もある。
//
// アルバム未選択の場合はalbumId:nullの「未分類」として保存される
// （ホーム画面の最近の投稿には表示されるが、どのアルバムページにも属さない）。

type UploadItem = {
  file: File;
  mode: "image" | "video";
  status: "idle" | "uploading" | "done" | "error";
  error?: string;
};

type AlbumOption = { id: string; title: string };

async function uploadViaSignedUrl(file: File, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size, ...extra }),
  });
  if (!res.ok) throw new Error((await res.text()) || "アップロードリクエストに失敗しました");
  const { post, photo } = await res.json();

  // post が無い場合はストレージ未設定のモック環境（ローカル開発時のフォールバック）。
  // 実際のオブジェクトアップロードは発生せず、既にDBに保存済みのモックURLをそのまま使う。
  if (post) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(post.fields as Record<string, string>)) {
      formData.append(key, value);
    }
    formData.append("file", file);

    const postRes = await fetch(post.url, { method: "POST", body: formData });
    if (!postRes.ok) throw new Error("ストレージへのアップロードに失敗しました");
  }

  return photo;
}

async function uploadOne(item: UploadItem, gameTag: string, albumId: string) {
  let thumbnailUrl: string | undefined;

  if (item.mode === "video") {
    const thumbBlob = await extractFirstFrame(item.file);
    const thumbFile = new File([thumbBlob], "thumbnail.jpg", { type: "image/jpeg" });
    const thumbPhoto = await uploadViaSignedUrl(thumbFile);
    thumbnailUrl = thumbPhoto.mediaUrl;
    await fetch(`/api/photos/${thumbPhoto.id}`, { method: "DELETE" }).catch(() => {});
  }

  await uploadViaSignedUrl(item.file, {
    thumbnailUrl,
    gameTitle: gameTag.trim() || undefined,
    albumId: albumId || undefined,
  });
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [gameTag, setGameTag] = useState("");
  const [running, setRunning] = useState(false);
  const [albums, setAlbums] = useState<AlbumOption[]>([]);
  const [albumId, setAlbumId] = useState(""); // "" = 未分類のまま

  useEffect(() => {
    fetch("/api/albums")
      .then((res) => (res.ok ? res.json() : { albums: [] }))
      .then((data) => setAlbums(data.albums ?? []))
      .catch(() => setAlbums([]));
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setItems(
      files.map((file) => ({
        file,
        mode: file.type.startsWith("video/") ? "video" : "image",
        status: "idle",
      }))
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleUploadAll() {
    setRunning(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue; // 既に完了したものは飛ばす（再試行時の重複防止）
      updateItem(i, { status: "uploading", error: undefined });
      try {
        await uploadOne(items[i], gameTag, albumId);
        updateItem(i, { status: "done" });
      } catch (err) {
        updateItem(i, {
          status: "error",
          error: err instanceof Error ? err.message : "アップロードに失敗しました",
        });
      }
    }
    setRunning(false);
  }

  const allDone = items.length > 0 && items.every((it) => it.status === "done");
  const anyError = items.some((it) => it.status === "error");

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        アップロード
      </h1>
      <p className="mt-1 font-mono text-xs text-steam-muted">
        画像、または30秒以内の動画クリップを複数まとめて選択できます
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        onChange={handleFileChange}
        className="hidden"
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={running}
        className="mt-4 flex h-32 w-full flex-col items-center justify-center rounded-sm border border-dashed border-steam-border bg-steam-surface disabled:opacity-50"
      >
        <UploadIcon size={20} className="text-steam-muted" />
        <p className="mt-2 font-mono text-xs text-steam-muted">
          {items.length > 0 ? "選び直す（クリック）" : "クリックしてファイルを選択（複数選択可）"}
        </p>
        <p className="mt-1 font-mono text-3xs text-steam-muted/60">
          画像: 最大15MB／動画: 最大30MB・30秒まで
        </p>
      </button>

      {items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-surface px-3 py-2"
            >
              {item.mode === "image" ? (
                <ImageIcon size={14} className="flex-shrink-0 text-steam-blue" />
              ) : (
                <Film size={14} className="flex-shrink-0 text-steam-blue" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">
                {item.file.name}
              </span>
              <span className="flex-shrink-0 font-mono text-3xs text-steam-muted">
                {(item.file.size / 1024 / 1024).toFixed(1)}MB
              </span>

              {item.status === "uploading" && (
                <span className="flex-shrink-0 font-mono text-3xs text-steam-blue">
                  アップロード中…
                </span>
              )}
              {item.status === "done" && (
                <Check size={14} className="flex-shrink-0 text-[#a4d007]" />
              )}
              {item.status === "error" && (
                <span className="flex flex-shrink-0 items-center gap-1 font-mono text-3xs text-[#eb4b4b]">
                  <AlertCircle size={12} /> 失敗
                </span>
              )}
              {item.status === "idle" && !running && (
                <button
                  onClick={() => removeItem(i)}
                  className="flex-shrink-0 p-1.5 text-steam-muted hover:text-[#eb4b4b]"
                  aria-label="削除"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <label className="font-mono text-2xs text-steam-muted">追加先アルバム</label>
        <select
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
          disabled={running}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        >
          <option value="">未分類のまま（後でアルバムに振り分ける）</option>
          {albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className="font-mono text-2xs text-steam-muted">
          ゲームタグ（任意・全ファイル共通）
        </label>
        <input
          value={gameTag}
          onChange={(e) => setGameTag(e.target.value)}
          placeholder="eldenring"
          disabled={running}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        />
      </div>

      <button
        onClick={handleUploadAll}
        disabled={items.length === 0 || running || allDone}
        className="mt-5 w-full rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
      >
        {running
          ? `アップロード中… (${items.filter((i) => i.status === "done").length}/${items.length})`
          : allDone
            ? "すべて完了"
            : anyError
              ? "失敗分をやり直す"
              : `${items.length || ""}件アップロード`}
      </button>

      {allDone && (
        <button
          onClick={() => router.push("/")}
          className="mt-2 w-full rounded-sm border border-steam-border py-2 font-mono text-xs text-steam-text"
        >
          ホームに戻る
        </button>
      )}
    </main>
  );
}
