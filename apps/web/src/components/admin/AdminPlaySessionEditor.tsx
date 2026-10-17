"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminGroupOption, AdminPlaySession } from "@/lib/playLogAdmin";

// /admin/play-log の「修正」「削除」「記録を追加」。サーバー側の一覧から1行ぶんの値を受け取ってモーダルで直す。
// API は /api/admin/play-sessions（管理者のみ）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO → `<input type="datetime-local">` の値（JST）。ブラウザのタイムゾーンに依存させない */
function toJstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/** `<input type="datetime-local">` の値（JSTとして読む）→ ISO */
function fromJstInput(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

type Draft = {
  groupId: string;
  groupGameId: string;
  start: string;
  end: string;
  participantIds: string[];
};

export function AdminPlaySessionActions({ session, groups }: { session: AdminPlaySession; groups: AdminGroupOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inProgress = session.endedAt === null;

  async function remove() {
    if (!window.confirm(`${session.title}（${session.groupName}）の記録を消します。元に戻せません。よろしいですか？`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/play-sessions/${session.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        window.alert(typeof body?.error === "string" ? body.error : "削除に失敗しました");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (inProgress) return <span className="font-mono text-4xs text-steam-muted">進行中（終わってから直せます）</span>;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        aria-label={`${session.title} の記録を修正`}
        className="inline-flex items-center gap-1 rounded-sm border border-steam-border px-2 py-1 font-mono text-4xs text-steam-blue hover:border-steam-blue"
      >
        <Pencil size={11} /> 修正
      </button>
      <button
        onClick={remove}
        disabled={deleting}
        aria-label={`${session.title} の記録を削除`}
        className="inline-flex items-center gap-1 rounded-sm border border-steam-border px-2 py-1 font-mono text-4xs text-[#eb4b4b] hover:border-[#eb4b4b] disabled:opacity-50"
      >
        {deleting ? <Spinner size={10} /> : <Trash2 size={11} />} 削除
      </button>
      {editing && (
        <PlaySessionModal
          title="プレイ記録を修正"
          groups={groups}
          lockGroup
          initial={{
            groupId: session.groupId,
            groupGameId: session.groupGameId ?? "",
            start: toJstInput(session.startedAt),
            end: toJstInput(session.endedAt!),
            participantIds: session.participants.map((p) => p.userId),
          }}
          // 名前だけの記録（ゲーム未結びつき）は「変えない」を選べるようにする
          allowKeepGame={session.groupGameId === null ? session.activityName : null}
          submitLabel="保存する"
          onSubmit={(draft) =>
            fetch(`/api/admin/play-sessions/${session.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                startedAt: fromJstInput(draft.start),
                endedAt: fromJstInput(draft.end),
                groupGameId: draft.groupGameId === "" ? undefined : draft.groupGameId,
                participantIds: draft.participantIds,
              }),
            })
          }
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function AdminAddPlaySessionButton({ groups, defaultGroupId }: { groups: AdminGroupOption[]; defaultGroupId: string | null }) {
  const [open, setOpen] = useState(false);
  const groupId = defaultGroupId ?? groups[0]?.id ?? "";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={groups.length === 0}
        className="inline-flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-1.5 font-mono text-3xs font-bold text-[#0e1b12] disabled:opacity-40"
      >
        <Plus size={12} /> 記録を追加
      </button>
      {open && (
        <PlaySessionModal
          title="記録されなかったプレイを追加"
          groups={groups}
          lockGroup={false}
          initial={{ groupId, groupGameId: "", start: "", end: "", participantIds: [] }}
          allowKeepGame={null}
          submitLabel="追加する"
          onSubmit={(draft) =>
            fetch("/api/admin/play-sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                groupId: draft.groupId,
                groupGameId: draft.groupGameId,
                startedAt: fromJstInput(draft.start),
                endedAt: fromJstInput(draft.end),
                participantIds: draft.participantIds,
              }),
            })
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PlaySessionModal({
  title,
  groups,
  lockGroup,
  initial,
  allowKeepGame,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  groups: AdminGroupOption[];
  lockGroup: boolean;
  initial: Draft;
  /** 名前だけの記録を直すとき、その名前。「ゲームは変えない」を選べる */
  allowKeepGame: string | null;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<Response>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = groups.find((g) => g.id === draft.groupId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const toggle = (userId: string) =>
    set("participantIds", draft.participantIds.includes(userId) ? draft.participantIds.filter((id) => id !== userId) : [...draft.participantIds, userId]);

  const needsGame = allowKeepGame === null;
  const canSubmit = !!draft.start && !!draft.end && draft.participantIds.length > 0 && (!needsGame || !!draft.groupGameId);

  async function submit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const res = await onSubmit(draft);
      if (!res.ok) {
        // 理由（終了が開始より前・24時間を超える等）はAPIが文章で返すので、そのまま出す
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "保存に失敗しました");
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("保存に失敗しました");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50";

  // body へ出す。親に backdrop-filter などがあると fixed が画面全体に広がらない（CLAUDE.md「画面の骨格」）
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !pending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-sm border border-steam-border bg-steam-surface p-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-steam-text">{title}</h2>
          <button onClick={onClose} disabled={pending} aria-label="閉じる" className="p-2 text-steam-muted hover:text-steam-text">
            <X size={16} />
          </button>
        </div>

        <label className="mt-3 block font-mono text-2xs text-steam-muted" htmlFor="play-group">
          グループ
        </label>
        <select
          id="play-group"
          value={draft.groupId}
          disabled={pending || lockGroup}
          onChange={(e) => setDraft((d) => ({ ...d, groupId: e.target.value, groupGameId: "", participantIds: [] }))}
          className={inputClass}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <label className="mt-3 block font-mono text-2xs text-steam-muted" htmlFor="play-game">
          ゲーム
        </label>
        <select id="play-game" value={draft.groupGameId} disabled={pending} onChange={(e) => set("groupGameId", e.target.value)} className={inputClass}>
          <option value="">{allowKeepGame ? `変えない（${allowKeepGame}）` : "ゲームを選択"}</option>
          {(group?.games ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block font-mono text-2xs text-steam-muted" htmlFor="play-start">
              開始（日本時間）
            </label>
            <input id="play-start" type="datetime-local" value={draft.start} disabled={pending} onChange={(e) => set("start", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block font-mono text-2xs text-steam-muted" htmlFor="play-end">
              終了（日本時間）
            </label>
            <input id="play-end" type="datetime-local" value={draft.end} disabled={pending} onChange={(e) => set("end", e.target.value)} className={inputClass} />
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="font-mono text-2xs text-steam-muted">参加者</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(group?.members ?? []).map((m) => (
              <label key={m.userId} className="inline-flex items-center gap-1.5 rounded-sm border border-steam-border px-2 py-1 font-mono text-3xs text-steam-text">
                <input
                  type="checkbox"
                  checked={draft.participantIds.includes(m.userId)}
                  disabled={pending}
                  onChange={() => toggle(m.userId)}
                  className="h-3.5 w-3.5 accent-[#a4d007]"
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className="rounded-sm border border-steam-border px-3 py-1.5 font-mono text-xs text-steam-muted">
            やめる
          </button>
          <button
            onClick={submit}
            disabled={pending || !canSubmit}
            className="inline-flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-4 py-1.5 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
          >
            {pending && <Spinner size={12} />} {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
