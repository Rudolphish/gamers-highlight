"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import type { RecentPatchNote } from "@/lib/gameUpdates";

/** 最初に出す件数。「もっと見る」で全部（2026-11-04 ユーザー判断） */
const INITIAL = 5;

/**
 * グループ画面の「ようす」の「アプデ情報」（2026-11-04 ユーザー判断）。
 * クリア済み以外のゲームに Steam の公式のパッチノートが出たら、直近30日を新しい順に並べる（lib/gameUpdates.ts の listRecentPatchNotes）。
 * 各行はゲーム名（ゲーム詳細へ）・更新日時（日本時間。文字はサーバーで作って渡す。CLAUDE.md）・アプデの題名（Steam のお知らせへ）。
 * 画面には絵文字を出さない（デザイン刷新の決まり。B125）
 */
export function GameUpdateFeed({ groupId, items }: { groupId: string; items: RecentPatchNote[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, INITIAL);
  return (
    <section aria-label="アプデ情報" data-testid="game-update-feed">
      <h2 className="font-display text-xl font-bold text-steam-text">アプデ情報</h2>
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-steam-surface px-3 py-4 text-sm text-steam-muted">最近のアプデはありません</p>
      ) : (
        <>
          <ol className="mt-3 rounded-xl bg-steam-surface">
            {shown.map((n, i) => (
              <li
                key={n.id}
                data-testid="game-update-item"
                className={`flex items-start gap-2.5 px-3 py-2.5 ${i > 0 ? "border-t border-steam-border/50" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-steam-panel text-update">
                  <Sparkles size={15} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-sm leading-5">
                    <Link href={`/groups/${groupId}/games/${n.gameId}`} className="truncate font-bold text-steam-text hover:text-steam-blue">
                      {n.gameTitle}
                    </Link>
                    <span className="shrink-0 font-num text-4xs text-steam-muted">{n.timeLabel}</span>
                  </p>
                  {n.url ? (
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 flex items-center gap-1 text-xs text-steam-muted hover:text-steam-blue"
                    >
                      <span className="truncate">{n.title}</span>
                      <ExternalLink size={11} aria-hidden="true" className="shrink-0" />
                    </a>
                  ) : (
                    <p className="mt-0.5 truncate text-xs text-steam-muted">{n.title}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {items.length > INITIAL && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mt-2 min-h-11 text-xs text-steam-blue hover:underline sm:min-h-9"
            >
              {all ? "閉じる" : `もっと見る（あと${items.length - INITIAL}件）`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
