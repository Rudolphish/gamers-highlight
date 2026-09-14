"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Upload as UploadIcon, Image as ImageIcon, Film, Check, AlertCircle } from "lucide-react";
import { MEDIA_LIMIT_LABELS } from "@/lib/media-limits";
import { addYoutubeMedia, uploadMediaFile } from "@/lib/uploadClient";
import { parseYoutubeUrl } from "@/lib/youtubeLink";

// アルバム詳細の「追加」。/upload と同じことをこのアルバムに限ってやる。
//
// **アップロードの手順そのものは持たない**（`lib/uploadClient.ts`）。
// 写すと片方だけ直して気づかない形になるため、`/upload` と同じ関数を呼ぶ。
//
// この画面が `/upload` と違うのは3点だけ:
//   - 追加先がもう決まっている（グループ／アルバムの選択欄が無い）
//   - ゲームタグを聞かない（アルバムがその文脈を持っている）
//   - Steamのスクショからの自動判別をしない（振り分け先が固定なので使い道が無い）
//
// **ボタンは見られる人全員に出す。** このアルバムに投稿できる条件は「見られること」
// （`POST /api/photos` は VIEWER で通す）なので、ページが描画されている人は全員上げられる。
// 権限はサーバーが毎回見るので、ここでの出し分けは表示だけの話。

type Item = {
  file: File;
  mode: "image" | "video";
  status: "idle" | "uploading" | "done" | "error";
  error?: string;
};

export function AddMediaModal({ albumId }: { albumId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"file" | "youtube">("file");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeState, setYoutubeState] = useState<"idle" | "saving" | "done">("idle");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const youtubeLink = parseYoutubeUrl(youtubeUrl);

  const allDone = items.length > 0 && items.every((it) => it.status === "done");
  const anyError = items.some((it) => it.status === "error");

  function close() {
    // アップロード中に閉じられると、進んでいるものの結果が分からなくなる
    if (running || youtubeState === "saving") return;
    setOpen(false);
    setItems([]);
    setYoutubeUrl("");
    setYoutubeError(null);
    setYoutubeState("idle");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setItems(
      files.map((file) => ({
        file,
        mode: file.type.startsWith("video/") ? ("video" as const) : ("image" as const),
        status: "idle" as const,
      }))
    );
  }

  function updateItem(index: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleUploadAll() {
    setRunning(true);
    // **1つずつ順番に。** 署名の発行を一度に大量に叩かないため（/upload と同じ理由）。
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue; // やり直し時に二重投稿しない
      updateItem(i, { status: "uploading", error: undefined });
      try {
        await uploadMediaFile(items[i].file, { albumId });
        updateItem(i, { status: "done" });
      } catch (err) {
        updateItem(i, {
          status: "error",
          error: err instanceof Error ? err.message : "アップロードに失敗しました",
        });
      }
    }
    setRunning(false);
    // **必ず引き直す。** キャッシュの無効化は `POST /api/photos` 側で済んでいるが、
    // 開いているページは自分では取り直さないので、これが無いと閉じても写真が増えない
    router.refresh();
  }

  async function handleAddYoutube() {
    const link = parseYoutubeUrl(youtubeUrl);
    if (!link) {
      setYoutubeError("YouTubeのURLとして読み取れませんでした");
      return;
    }
    setYoutubeState("saving");
    setYoutubeError(null);
    try {
      await addYoutubeMedia(link.canonicalUrl, { albumId });
      setYoutubeUrl("");
      setYoutubeState("done");
      router.refresh();
    } catch (err) {
      setYoutubeState("idle");
      setYoutubeError(err instanceof Error ? err.message : "追加に失敗しました");
    }
  }

  return (
    <>
      {/* **名前を「追加」だけにしない。** 同じページのタグ管理にも「追加」があるので、
          読み上げでも自動テストでも見分けが付かなくなる（見える文字はそのまま） */}
      <button
        onClick={() => setOpen(true)}
        aria-label="写真・動画を追加"
        className="flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12]"
      >
        <Plus size={14} /> 追加
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">
                写真・動画を追加
              </h2>
              <button
                onClick={close}
                aria-label="閉じる"
                className="p-2 text-steam-muted hover:text-steam-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setTab("file")}
                className={`flex-1 rounded-sm border px-3 py-1.5 font-mono text-xs ${
                  tab === "file"
                    ? "border-steam-blue text-steam-text"
                    : "border-steam-border text-steam-muted"
                }`}
              >
                ファイル
              </button>
              <button
                onClick={() => setTab("youtube")}
                className={`flex-1 rounded-sm border px-3 py-1.5 font-mono text-xs ${
                  tab === "youtube"
                    ? "border-steam-blue text-steam-text"
                    : "border-steam-border text-steam-muted"
                }`}
              >
                YouTube
              </button>
            </div>

            {tab === "file" ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
                  onChange={handleFileChange}
                  aria-label="ファイルを選択"
                  className="hidden"
                />

                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={running}
                  className="mt-3 flex h-24 w-full flex-col items-center justify-center rounded-sm border border-dashed border-steam-border bg-steam-panel disabled:opacity-50"
                >
                  <UploadIcon size={18} className="text-steam-muted" />
                  <p className="mt-1.5 font-mono text-xs text-steam-muted">
                    {items.length > 0 ? "選び直す（クリック）" : "クリックしてファイルを選択（複数選択可）"}
                  </p>
                  <p className="mt-1 font-mono text-4xs text-steam-muted/60">
                    {`画像: 最大${MEDIA_LIMIT_LABELS.imageSize}／動画: 最大${MEDIA_LIMIT_LABELS.videoSize}・${MEDIA_LIMIT_LABELS.videoDuration}まで`}
                  </p>
                </button>

                {items.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel px-2.5 py-1.5"
                      >
                        {item.mode === "image" ? (
                          <ImageIcon size={13} className="flex-shrink-0 text-steam-blue" />
                        ) : (
                          <Film size={13} className="flex-shrink-0 text-steam-blue" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-steam-text">
                          {item.file.name}
                        </span>
                        <span className="flex-shrink-0 font-mono text-4xs text-steam-muted">
                          {(item.file.size / 1024 / 1024).toFixed(1)}MB
                        </span>
                        {item.status === "uploading" && (
                          <span className="flex-shrink-0 font-mono text-4xs text-steam-blue">
                            送信中…
                          </span>
                        )}
                        {item.status === "done" && (
                          <Check size={13} className="flex-shrink-0 text-[#a4d007]" />
                        )}
                        {item.status === "error" && (
                          <span
                            title={item.error}
                            className="flex flex-shrink-0 items-center gap-1 font-mono text-4xs text-[#eb4b4b]"
                          >
                            <AlertCircle size={11} /> 失敗
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* 失敗の理由は一覧に収まらないので、最初の1件だけ本文で出す
                    （「失敗」だけだと容量超過なのか長すぎるのか分からない） */}
                {anyError && (
                  <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">
                    {items.find((it) => it.status === "error")?.error}
                  </p>
                )}

                <button
                  onClick={handleUploadAll}
                  disabled={items.length === 0 || running || allDone}
                  className="mt-4 w-full rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
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
                    onClick={close}
                    className="mt-2 w-full rounded-sm border border-steam-border py-2 font-mono text-xs text-steam-text"
                  >
                    閉じる
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="mt-3 font-mono text-2xs text-steam-muted">
                  長い動画はYouTubeに上げてURLを貼れば、このアルバムに並べられます。容量・長さの制限はありません。
                </p>

                <input
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setYoutubeError(null);
                    setYoutubeState("idle");
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={youtubeState === "saving"}
                  aria-label="YouTubeのURL"
                  className="mt-3 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
                />

                {youtubeUrl.trim().length > 0 && !youtubeLink && (
                  <p className="mt-1 font-mono text-3xs text-[#eb4b4b]">
                    YouTubeのURLとして読み取れません（watch / youtu.be / shorts のURLに対応しています）
                  </p>
                )}

                {youtubeLink && (
                  /* サムネイルは動画IDから組み立てるだけ。外部への問い合わせは無い */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={youtubeLink.thumbnailUrl}
                    alt=""
                    className="mt-3 h-20 w-36 rounded-sm border border-steam-border object-cover"
                  />
                )}

                <button
                  onClick={handleAddYoutube}
                  disabled={!youtubeLink || youtubeState === "saving"}
                  className="mt-4 w-full rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40"
                >
                  {youtubeState === "saving" ? "追加中…" : "この動画を追加"}
                </button>

                {youtubeState === "done" && (
                  <p className="mt-2 font-mono text-3xs text-[#a4d007]">
                    追加しました。続けて別のURLも貼れます。
                  </p>
                )}
                {youtubeError && (
                  <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">{youtubeError}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
