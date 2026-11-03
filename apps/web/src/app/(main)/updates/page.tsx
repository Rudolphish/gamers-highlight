import { PATCH_NOTES, CURRENT_VERSION, patchNoteDateLabel } from "@/content/patchNotes";
import { PatchNoteBody } from "@/components/PatchNoteBody";

// 「更新履歴」：これまでのパッチノート（content/patchNotes.ts）を新しい順に並べる（2026-11-03 ユーザー判断）。
// 友人に公開した 2026-08-22 を v1.0.0 として数えている。Discord へ送るのは管理画面から（/admin/release-notes）
export const metadata = { title: "更新履歴" };

export default function UpdatesPage() {
  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">更新履歴</h1>
      <p className="mt-1 text-sm text-steam-muted">{`いまの版は v${CURRENT_VERSION} です。新しい順に並んでいます。`}</p>

      <ol className="mt-6 space-y-4">
        {PATCH_NOTES.map((note) => (
          <li key={note.version} data-testid="patch-note" className="rounded-xl bg-steam-panel p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-lg font-bold text-steam-text">{`v${note.version}`}</h2>
              <span className="font-num text-xs text-steam-muted">{patchNoteDateLabel(note.date)}</span>
            </div>
            <div className="mt-3">
              <PatchNoteBody note={note} />
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
