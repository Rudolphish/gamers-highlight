import { Bug, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import { PATCH_NOTE_SECTIONS, type PatchNote } from "@/content/patchNotes";

/** 区分ごとの線のアイコン（画面には絵文字を出さない。content/patchNotes.ts） */
const ICONS: Record<(typeof PATCH_NOTE_SECTIONS)[number]["key"], LucideIcon> = {
  added: Sparkles,
  changed: Wrench,
  fixed: Bug,
};

/**
 * パッチノート1件の中身（区分ごとの箇条書き）。「更新履歴」のページと、管理画面の送る前の確認で使う。
 * Discord へ送る埋め込み（lib/releaseNotes.ts の buildReleaseEmbed）と同じ区分・同じ順に並べる
 */
export function PatchNoteBody({ note }: { note: PatchNote }) {
  return (
    <div className="space-y-3">
      {PATCH_NOTE_SECTIONS.filter((s) => note[s.key].length > 0).map((s) => {
        const Icon = ICONS[s.key];
        return (
          <section key={s.key}>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-steam-text">
              <Icon size={15} aria-hidden="true" className="text-steam-blue" />
              {s.label}
            </h3>
            <ul className="mt-1 space-y-1 text-sm text-steam-muted">
              {note[s.key].map((line) => (
                <li key={line} className="flex gap-1.5">
                  <span aria-hidden="true">・</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
