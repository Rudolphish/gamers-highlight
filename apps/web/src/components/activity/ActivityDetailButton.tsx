"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, ExternalLink, Play, X } from "lucide-react";
import type { ActivityDetail } from "@/lib/activityDetail";
import { ghostIconButton, secondaryButton } from "@/components/ui/buttonStyles";
import { modalOverlay, modalPanel } from "@/components/ui/modalStyles";
import { Spinner } from "@/components/ui/Spinner";

/**
 * 「最近の動き」「みんなの動き」の1行。押すとモーダルで詳細を出す（2026-11-13 ユーザー判断）。
 *
 * - 中身は**押したときに** GET /api/activity?ids=… で読む（lib/activityDetail.ts）。一度読んだら閉じても覚えておく
 * - 行の見た目（アイコン・文言・補足）はサーバーで描いて children で受け取る
 * - モーダルは modalStyles の枠とパネル（縦が短い画面でも上から下まで届く。CLAUDE.md）。body へ出す
 * - Esc・枠の外・「閉じる」で閉じる
 */
export function ActivityDetailButton({ ids, label, children }: { ids: string[]; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setFailed(false);
    try {
      const res = await fetch(`/api/activity?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setDetail(((await res.json()) as { detail: ActivityDetail }).detail);
    } catch {
      setFailed(true);
    } finally {
      loading.current = false;
    }
  }, [ids]);

  const onOpen = () => {
    setOpen(true);
    if (!detail) void load();
  };

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${label} の詳細を見る`}
        data-testid="activity-row-button"
        className="flex min-h-11 w-full items-start gap-2.5 rounded-lg py-2 text-left transition hover:bg-steam-panel/50"
      >
        {children}
        <ChevronRight size={14} aria-hidden="true" className="mt-2.5 shrink-0 text-steam-muted" />
      </button>
      {open && (
        <ActivityDetailModal detail={detail} failed={failed} label={label} onRetry={load} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ActivityDetailModal({
  detail,
  failed,
  label,
  onRetry,
  onClose,
}: {
  detail: ActivityDetail | null;
  failed: boolean;
  label: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className={modalOverlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-detail-title"
        data-testid="activity-detail"
        onClick={(e) => e.stopPropagation()}
        className={modalPanel}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="activity-detail-title" className="font-display text-lg font-semibold text-steam-text">
              {detail?.title ?? label}
            </h2>
            {detail?.meta && <p className="mt-0.5 font-num text-4xs text-steam-muted">{detail.meta}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="閉じる" className={ghostIconButton}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {!detail && !failed && (
          <div className="flex justify-center py-8 text-steam-muted" data-testid="activity-detail-loading">
            <Spinner size={20} />
          </div>
        )}
        {!detail && failed && (
          <div className="py-6 text-center text-sm text-steam-muted">
            <p>読み込めませんでした</p>
            <button type="button" onClick={onRetry} className={`${secondaryButton} mt-3`}>
              もう一度読む
            </button>
          </div>
        )}

        {detail && (
          <div className="mt-3 space-y-3">
            {detail.image && (
              <div className="relative aspect-[460/215] w-full overflow-hidden rounded-lg bg-steam-panel">
                <Image src={detail.image.url} alt={detail.image.alt} fill sizes="(max-width: 448px) 100vw, 448px" className="object-cover" />
              </div>
            )}
            {detail.photos.length > 0 && (
              <div>
                <ul className="grid grid-cols-3 gap-1.5" data-testid="activity-detail-photos">
                  {detail.photos.map((p) => (
                    <li key={p.id} className="relative aspect-square overflow-hidden rounded-md bg-steam-panel">
                      {p.url && <Image src={p.url} alt="" fill sizes="140px" className="object-cover" />}
                      {p.video && (
                        <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white">
                          <Play size={10} fill="white" aria-hidden="true" />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {detail.morePhotos > 0 && <p className="mt-1 text-3xs text-steam-muted">ほか {detail.morePhotos} 枚</p>}
              </div>
            )}
            {detail.gone && <p className="rounded-lg bg-steam-panel px-3 py-2 text-xs text-steam-muted">{detail.gone}</p>}
            {detail.rows.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                {detail.rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-steam-muted">{r.label}</dt>
                    <dd className="min-w-0 break-words text-steam-text">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.links.length > 0 && (
              <div className="flex flex-col gap-2 pt-1">
                {detail.links.map((l) =>
                  l.external ? (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={`${secondaryButton} w-full`}>
                      {l.label}
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  ) : (
                    <Link key={l.href} href={l.href} onClick={onClose} className={`${secondaryButton} w-full`}>
                      {l.label}
                    </Link>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
