import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { PATCH_NOTES } from "@/content/patchNotes";
import { releaseNoteStatus, releaseNoteTitle, type ReleaseNoteGroupStatus } from "@/lib/releaseNotes";
import { AdminNav } from "@/components/admin/AdminNav";
import { SectionError } from "@/components/admin/SectionError";
import { PatchNoteBody } from "@/components/PatchNoteBody";
import { ReleaseNoteSendButton } from "@/components/admin/ReleaseNoteSendButton";

// 管理者ページ（更新のお知らせ）：パッチノート（content/patchNotes.ts）を、送る前にここで確かめてから
// グループごとの送り先（通知の種類 RELEASE_NOTES）へ送る（lib/releaseNotes.ts）。
// **送るのは今の版だけ。** 過去の版は「更新履歴」のページで読めるので、ここには出さない
export const dynamic = "force-dynamic";

export default async function AdminReleaseNotesPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const note = PATCH_NOTES[0];
  // 取得に失敗してもページ全体は落とさない（CLAUDE.md「外部依存はセクション単位で失敗させる」）
  let status: ReleaseNoteGroupStatus[] | null = null;
  try {
    status = await releaseNoteStatus(note.version);
  } catch (e) {
    console.error("[release-notes] 送った記録を読めませんでした", e);
  }
  const pending = status?.filter((g) => g.channelId && !g.sentAt).length ?? 0;

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">更新のお知らせ</h1>
      <AdminNav />

      <section className="mt-6 rounded-xl bg-steam-panel p-4">
        <h2 className="font-display text-lg font-bold text-steam-text">{releaseNoteTitle(note)}</h2>
        <p className="mt-1 text-xs text-steam-muted">Discord には、この内容を色付きの枠で送ります。</p>
        <div className="mt-3">
          <PatchNoteBody note={note} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-3xs font-bold uppercase tracking-wide text-steam-muted">グループごとの送り先</h2>
        {status === null ? (
          <SectionError message="送った記録を読めませんでした" />
        ) : (
          <>
            <ul className="mt-2 divide-y divide-steam-border rounded-xl bg-steam-panel" data-testid="release-note-status">
              {status.map((g) => (
                <li key={g.groupId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-steam-text">{g.groupName}</span>
                  <span className="text-xs text-steam-muted">
                    {!g.channelId
                      ? "送り先なし（グループの通知設定で「アプリの更新のお知らせ」を選ぶと送れます）"
                      : g.sentAt
                        ? `送信済み（${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(g.sentAt))}）`
                        : "未送信"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <ReleaseNoteSendButton version={note.version} pending={pending} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
