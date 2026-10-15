"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FolderInput, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

// `/admin/media` で、未分類の投稿（誰の投稿でも）を選んでアルバムへ振り分ける。
//
// ページ本体はサーバー部品のままにして、選択の状態だけをこの Provider に持たせる。
// 行ごとのチェックと「振り分け」ボタン、下に出る操作バー、モーダルはすべてここから読む。
// 移すAPIは未分類の画面と同じ `/api/photos/assign-album`（管理者は他の人の投稿も移せる）。

/** **groupId を必ず持つ。** アルバムは名前だけで選ばせない（別グループの同名を取り違えるため） */
type AlbumOption = { id: string; title: string; groupId: string };
type GroupOption = { id: string; name: string };

type Ctx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  openFor: (ids: string[]) => void;
};

const AssignContext = createContext<Ctx | null>(null);

function useAssign(): Ctx {
  const ctx = useContext(AssignContext);
  if (!ctx) throw new Error("AdminAssignProvider の中で使うこと");
  return ctx;
}

export function AdminAssignProvider({
  albums,
  groups,
  children,
}: {
  albums: AlbumOption[];
  groups: GroupOption[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** モーダルで移す対象。null＝閉じている */
  const [target, setTarget] = useState<string[] | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AssignContext.Provider value={{ selected, toggle, openFor: setTarget }}>
      {children}

      {selected.size > 0 && (
        <div className="sticky bottom-3 z-30 mt-4 flex items-center justify-between gap-3 rounded-sm border border-steam-blue bg-steam-surface px-3 py-2 shadow-lg">
          <span className="font-mono text-xs text-steam-text">未分類 {selected.size}件を選択中</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="font-mono text-3xs text-steam-muted hover:text-steam-text"
            >
              選択解除
            </button>
            <button
              onClick={() => setTarget(Array.from(selected))}
              className="inline-flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-1.5 font-mono text-3xs font-bold text-[#0e1b12]"
            >
              <FolderInput size={12} /> まとめて振り分け
            </button>
          </div>
        </div>
      )}

      {target && (
        <AssignModal
          photoIds={target}
          albums={albums}
          groups={groups}
          onClose={() => setTarget(null)}
          onDone={() => {
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of target) next.delete(id);
              return next;
            });
            setTarget(null);
          }}
        />
      )}
    </AssignContext.Provider>
  );
}

/** 未分類の行に出すチェック（まとめて振り分ける用） */
export function AssignCheckbox({ photoId, label }: { photoId: string; label: string }) {
  const { selected, toggle } = useAssign();
  return (
    <input
      type="checkbox"
      checked={selected.has(photoId)}
      onChange={() => toggle(photoId)}
      aria-label={`${label} を振り分けの対象にする`}
      className="h-4 w-4 accent-[#a4d007]"
    />
  );
}

/** 未分類の行に出す「振り分け」（その1件だけをモーダルで移す） */
export function AssignButton({ photoId, compact = false }: { photoId: string; compact?: boolean }) {
  const { openFor } = useAssign();
  return (
    <button
      onClick={() => openFor([photoId])}
      title="アルバムに振り分け"
      aria-label="アルバムに振り分け"
      className={
        compact
          ? "rounded-sm bg-black/60 p-1 text-steam-blue backdrop-blur-sm hover:text-steam-text"
          : "inline-flex items-center gap-1 rounded-sm border border-steam-border px-2 py-1 font-mono text-4xs text-steam-blue hover:border-steam-blue"
      }
    >
      <FolderInput size={compact ? 11 : 12} />
      {!compact && "振り分け"}
    </button>
  );
}

function AssignModal({
  photoIds,
  albums,
  groups,
  onClose,
  onDone,
}: {
  photoIds: string[];
  albums: AlbumOption[];
  groups: GroupOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  // 1つしか入っていないなら自動で選ぶ（未分類の画面と同じ）
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0].id : "");
  const [albumId, setAlbumId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const albumsInGroup = albums.filter((a) => a.groupId === groupId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function submit() {
    if (!albumId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/photos/assign-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds, albumId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { movedCount } = (await res.json()) as { movedCount: number };
      // 0件＝誰かが先に振り分けた等。黙って閉じると「移したつもり」になるので伝える
      if (movedCount === 0) {
        setError("移せる投稿がありませんでした（すでに振り分け済みの可能性があります）");
        router.refresh();
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setError("振り分けに失敗しました");
    } finally {
      setPending(false);
    }
  }

  // body へ出す。親に backdrop-filter などがあると fixed が画面全体に広がらない（CLAUDE.md「画面の骨格」）
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="アルバムに振り分け"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-steam-text">
            アルバムに振り分け（{photoIds.length}件）
          </h2>
          <button onClick={onClose} disabled={pending} aria-label="閉じる" className="p-2 text-steam-muted hover:text-steam-text">
            <X size={16} />
          </button>
        </div>

        <label className="mt-3 block font-mono text-2xs text-steam-muted" htmlFor="admin-assign-group">
          グループ
        </label>
        <select
          id="admin-assign-group"
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value);
            setAlbumId("");
          }}
          disabled={pending}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        >
          <option value="">グループを選択</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <label className="mt-3 block font-mono text-2xs text-steam-muted" htmlFor="admin-assign-album">
          アルバム
        </label>
        <select
          id="admin-assign-album"
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
          disabled={pending || !groupId}
          className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
        >
          <option value="">{!groupId ? "先にグループを選択" : albumsInGroup.length === 0 ? "このグループにアルバムがありません" : "アルバムを選択"}</option>
          {albumsInGroup.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <p className="mt-1 font-mono text-4xs text-steam-muted/70">
          あなたが編集できるアルバムだけに振り分けられます
        </p>

        {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className="rounded-sm border border-steam-border px-3 py-1.5 font-mono text-xs text-steam-muted">
            やめる
          </button>
          <button
            onClick={submit}
            disabled={pending || !albumId}
            className="inline-flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-1.5 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
          >
            {pending && <Spinner size={12} />} 振り分ける
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
