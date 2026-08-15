"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload as UploadIcon, Image as ImageIcon, Film, X, Check, AlertCircle, Wand2 } from "lucide-react";
import { extractFirstFrame } from "@/lib/video-thumbnail";
import { parseSteamScreenshotName } from "@/lib/steamScreenshot";

// アップロード画面：画像 or 30秒以内の動画クリップを複数まとめてアップロード可能。
//
// 1ファイルごとの流れ：
//   1. contentTypeで画像/動画を判定
//   2. 動画の場合、まず1フレーム目をcanvasで抽出してサムネイル画像を作る
//   3. サムネイル(動画の場合のみ)→本体の順で、署名付きPOSTポリシー(/api/photos/upload-url)を
//      取得してR2へ直接POST
//   4. **上げ切ってから** /api/photos でPhotoレコードを作る
//
// 4を最後に回しているのが重要。以前は先にレコードを作ってから署名を返していたため、
// ストレージへのPOSTが失敗すると404のURLを指したPhotoが残り、ホームやアルバムに
// 壊れた画像として出続けていた（電波の悪い場所では普通に起きる）。
// 今の順序なら、失敗して残るのは参照されないオブジェクトだけで画面には出ない
// （/admin の「孤児ファイル」で把握できる）。
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
  /** ファイル名から読み取ったSteamのapp ID（Steamのスクショ以外はnull） */
  appId: number | null;
  /** 撮影日時。ファイル名に入っているので、投稿日とは別に残せる */
  capturedAt: Date | null;
};

/** app IDを解決した結果。/api/photos/identify の返り */
type IdentifiedGame = {
  appId: number;
  title: string | null;
  album: { id: string; title: string } | null;
};

type AlbumOption = { id: string; title: string };

// post が無い場合はストレージ未設定のモック環境（ローカル開発時のフォールバック）。
// 実際のオブジェクトアップロードは発生せず、既に返ってきているモックURLをそのまま使う。
async function postFileToStorage(post: { url: string; fields: Record<string, string> } | null, file: File) {
  if (!post) return;
  const formData = new FormData();
  for (const [key, value] of Object.entries(post.fields)) {
    formData.append(key, value);
  }
  formData.append("file", file);

  const postRes = await fetch(post.url, { method: "POST", body: formData });
  if (!postRes.ok) throw new Error("ストレージへのアップロードに失敗しました");
}

/**
 * 署名付きURLを受け取ってストレージへ上げるところまで。Photoレコードは作らない。
 * 上げ切ってから作ることで、途中で失敗しても「ファイルが無いのにレコードだけある」
 * 状態にならない（失敗時に残るのは参照されないオブジェクトだけで、画面には出ない）。
 */
async function uploadToStorage(file: File, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch("/api/photos/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size, ...extra }),
  });
  if (!res.ok) throw new Error((await res.text()) || "アップロードリクエストに失敗しました");
  const { post, publicUrl } = await res.json();
  await postFileToStorage(post, file);
  return publicUrl;
}

async function createPhotoRecord(body: Record<string, unknown>) {
  const res = await fetch("/api/photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || "投稿の保存に失敗しました");
  return (await res.json()).photo;
}

/**
 * 1ファイル分の保存内容を決める。
 *
 * **手で入れた値を必ず優先する。** 自動判別はあくまで手間を省くためのもので、
 * 入力を上書きしてしまうと「指定したのに違うタグが付く」ことになるため。
 */
function resolveTagging(
  item: UploadItem,
  identified: Map<number, IdentifiedGame>,
  manualTag: string,
  manualAlbumId: string
) {
  const detected = item.appId !== null ? identified.get(item.appId) : undefined;
  return {
    gameTitle: manualTag.trim() || detected?.title || undefined,
    albumId: manualAlbumId || detected?.album?.id || undefined,
  };
}

async function uploadOne(
  item: UploadItem,
  identified: Map<number, IdentifiedGame>,
  gameTag: string,
  albumId: string
) {
  let thumbnailUrl: string | undefined;

  if (item.mode === "video") {
    const thumbBlob = await extractFirstFrame(item.file);
    const thumbFile = new File([thumbBlob], "thumbnail.jpg", { type: "image/jpeg" });
    thumbnailUrl = await uploadToStorage(thumbFile);
  }

  const mediaUrl = await uploadToStorage(item.file);
  const { gameTitle, albumId: resolvedAlbumId } = resolveTagging(item, identified, gameTag, albumId);

  await createPhotoRecord({
    contentType: item.file.type,
    mediaUrl,
    sizeBytes: item.file.size,
    thumbnailUrl,
    gameTitle,
    albumId: resolvedAlbumId,
    capturedAt: item.capturedAt?.toISOString(),
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
  const [identified, setIdentified] = useState<Map<number, IdentifiedGame>>(new Map());
  const [identifying, setIdentifying] = useState(false);

  useEffect(() => {
    fetch("/api/albums")
      .then((res) => (res.ok ? res.json() : { albums: [] }))
      .then((data) => setAlbums(data.albums ?? []))
      .catch(() => setAlbums([]));
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const next: UploadItem[] = files.map((file) => {
      const info = parseSteamScreenshotName(file.name);
      return {
        file,
        mode: file.type.startsWith("video/") ? "video" : "image",
        status: "idle",
        appId: info?.appId ?? null,
        capturedAt: info?.capturedAt ?? null,
      };
    });
    setItems(next);
    identify(next);
  }

  /**
   * ファイル名から読み取ったapp IDを、ゲーム名と既存アルバムに解決する。
   * 判別できたものが1つも無ければ問い合わせない。
   */
  async function identify(list: UploadItem[]) {
    const appIds = [...new Set(list.map((i) => i.appId).filter((n): n is number => n !== null))];
    if (appIds.length === 0) {
      setIdentified(new Map());
      return;
    }

    setIdentifying(true);
    try {
      const res = await fetch("/api/photos/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appIds }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setIdentified(
        new Map((data.results as IdentifiedGame[]).map((r) => [r.appId, r]))
      );
    } catch {
      // 判別できなくてもアップロード自体は続けられるので、黙って手入力に任せる
      setIdentified(new Map());
    } finally {
      setIdentifying(false);
    }
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
        await uploadOne(items[i], identified, gameTag, albumId);
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

  // 画面に出すのは「今選んでいるファイルに含まれるゲーム」だけ
  // ゲーム名が確定したものだけ出す。ファイル名がたまたま `123_456.jpg` だった場合に
  // 「Steam app 123」のような当てにならない表示を出さないため。
  const detectedGames = [...new Set(items.map((i) => i.appId).filter((n): n is number => n !== null))]
    .map((appId) => identified.get(appId))
    .filter((g): g is IdentifiedGame => Boolean(g?.title));

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
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-steam-text">
                  {item.file.name}
                </span>
                {item.appId !== null && (identifying || identified.get(item.appId)?.title) && (
                  <span className="block truncate font-mono text-3xs text-[#a4d007]">
                    {identified.get(item.appId)?.title ?? "判別中…"}
                  </span>
                )}
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

      {detectedGames.length > 0 && (
        <div className="mt-4 rounded-sm border border-[#a4d007]/40 bg-steam-panel p-3">
          <p className="flex items-center gap-1.5 font-mono text-2xs text-steam-text">
            <Wand2 size={12} className="text-[#a4d007]" />
            ファイル名からゲームを判別しました
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {detectedGames.map((g) => (
              <li key={g.appId} className="font-mono text-3xs text-steam-muted">
                <span className="text-steam-text">{g.title ?? `Steam app ${g.appId}`}</span>
                {" … "}
                {g.album ? (
                  <span className="text-[#a4d007]">アルバム「{g.album.title}」に追加します</span>
                ) : (
                  <span className="text-steam-muted/70">
                    このゲームのアルバムはまだありません（未分類で保存されます）
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-4xs text-steam-muted/70">
            下でアルバムやタグを指定した場合は、そちらが優先されます。
          </p>
        </div>
      )}

      <div className="mt-4">
        <label className="font-mono text-2xs text-steam-muted">追加先アルバム</label>
        <select
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
          disabled={running}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        >
          <option value="">
            {detectedGames.some((g) => g.album)
              ? "判別結果にまかせる（該当アルバムへ／無ければ未分類）"
              : "未分類のまま（後でアルバムに振り分ける）"}
          </option>
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
          {detectedGames.length > 0 && (
            <span className="ml-1 text-steam-muted/70">— 空なら判別したゲーム名が入ります</span>
          )}
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
