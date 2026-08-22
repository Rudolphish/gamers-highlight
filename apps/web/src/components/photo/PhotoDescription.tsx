"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/photoDescription";

export type DescriptionState = {
  text: string | null;
  editorName: string | null;
  updatedAt: string | null;
};

/**
 * 写真の説明。Lightboxの中で表示と編集の両方をする。
 *
 * **1枚につき1つ。** コメントのように積み上がらず、EDITOR以上なら誰でも書き換えられる
 * 共有の情報として扱う。空にすると説明が消える（写真は消えない）。
 *
 * 保存はリアクションと違って**返ってくるまで待つ**。数を増やすだけのトグルと違い、
 * 書いた文章が消えるのが一番困るので、失敗したときに入力内容を残せる形にしている。
 */
export function PhotoDescription({
  photoId,
  initial,
  canEdit,
  onSaved,
}: {
  photoId: string;
  initial: DescriptionState;
  canEdit: boolean;
  onSaved?: (next: DescriptionState) => void;
}) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: draft }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as {
        description: string | null;
        descriptionUpdatedAt: string | null;
        descriptionEditorName: string | null;
      };
      const next: DescriptionState = {
        text: json.description,
        editorName: json.descriptionEditorName,
        updatedAt: json.descriptionUpdatedAt,
      };
      setState(next);
      onSaved?.(next);
      setEditing(false);
    } catch {
      // **入力内容は消さない。** ここで draft を戻すと書いた文章が失われる
      setError("保存できませんでした。もう一度お試しください");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={4}
          autoFocus
          placeholder="この場面の説明を書く（空にすると消えます）"
          className="w-full resize-none rounded-sm border border-steam-border bg-steam-bg p-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-3xs text-steam-muted">
            {draft.length}/{MAX_DESCRIPTION_LENGTH}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setDraft(state.text ?? "");
                setEditing(false);
                setError(null);
              }}
              aria-label="編集をやめる"
              className="rounded-sm border border-steam-border px-2 py-1 font-mono text-3xs text-steam-muted hover:text-steam-text"
            >
              <X size={12} />
            </button>
            <button
              onClick={save}
              disabled={saving}
              aria-label="説明を保存"
              className="flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-2.5 py-1 font-mono text-3xs font-bold text-[#0e1b12] disabled:opacity-60"
            >
              {saving ? <Spinner size={12} /> : <Check size={12} />} 保存
            </button>
          </div>
        </div>
        {error && <p className="font-mono text-3xs text-[#e05a5a]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {state.text ? (
        // 改行を活かす。説明は箇条書きになりがちなため
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-steam-text">
          {state.text}
        </p>
      ) : (
        <p className="font-mono text-3xs text-steam-muted">説明はまだありません</p>
      )}

      <div className="flex items-center justify-between gap-2">
        {state.text && state.editorName ? (
          <span className="font-mono text-3xs text-steam-muted/70">
            {state.editorName}
            {state.updatedAt ? `・${new Date(state.updatedAt).toLocaleDateString("ja-JP")}` : ""}
          </span>
        ) : (
          <span />
        )}
        {canEdit && (
          <button
            onClick={() => {
              setDraft(state.text ?? "");
              setEditing(true);
            }}
            aria-label={state.text ? "説明を編集" : "説明を書く"}
            className="flex items-center gap-1 rounded-sm border border-steam-border px-2 py-1 font-mono text-3xs text-steam-muted transition hover:border-steam-blue hover:text-steam-blue"
          >
            <Pencil size={11} /> {state.text ? "編集" : "説明を書く"}
          </button>
        )}
      </div>
    </div>
  );
}
