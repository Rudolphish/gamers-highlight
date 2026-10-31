"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./Spinner";
import { dangerButton, secondaryButton } from "./buttonStyles";
import { modalOverlay, modalPanel } from "./modalStyles";

/**
 * 取り返しのつかない操作の前のひと手間（2026-10-31。ウィッシュリストの取り下げを押し間違えるという報告から）。
 *
 * ほかの削除（アルバム・写真・グループ）はブラウザの `window.confirm` を使っているが、こちらは画面のモーダルと
 * 同じ見た目で出す（対象の名前を出し、実行のボタンは赤）。
 *
 * - **最初に選ばれているのは「やめる」**。続けて Enter を押しても実行されない
 * - 枠の外を押す・Esc でも閉じる（＝やめる）。実行中は閉じない
 * - body へ出す。親に backdrop-filter などがあると fixed が画面全体に広がらない（CLAUDE.md「画面の骨格」）
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  return createPortal(
    <div className={modalOverlay} onClick={() => !pending && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
        className={modalPanel}
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold text-steam-text">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-steam-muted">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={pending} className={secondaryButton}>
            やめる
          </button>
          <button onClick={onConfirm} disabled={pending} className={dangerButton}>
            {pending && <Spinner size={16} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
