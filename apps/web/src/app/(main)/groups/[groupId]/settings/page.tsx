import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { isAdminEmail } from "@/lib/admin";
import { getPlayLogMinParticipants } from "@/lib/playLog";
import { NotificationSettings } from "@/components/group/NotificationSettings";
import { PlayLogMinParticipantsSetting } from "@/components/group/PlayLogMinParticipantsSetting";
import { DeleteGroupButton } from "@/components/group/DeleteGroupButton";

export const dynamic = "force-dynamic";

// グループの設定（2026-10 のデザイン刷新で新設）。グループ画面の歯車から来る。
// 以前はグループ画面の見出しの下に、通知の設定・プレイ記録の最少人数・削除のボタンが並んでいて、
// 毎日見る画面の一番上を、めったに触らない設定が占めていた。
//
// **権限はページでも判定する**（CLAUDE.md「ページはAPIの権限判定を通らない」）。
// 通知と削除はオーナー、最少人数は管理者だけ。どちらでもない人には存在ごと伏せて404にする
// （メンバーにとっては設定できる項目が1つも無い画面になるため）。
export default async function GroupSettingsPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const currentUser = await getCurrentUser();
  if (!currentUser) notFound();
  if (!(await hasGroupPermission(params.groupId, currentUser.id, "VIEWER"))) notFound();

  const group = await db.group.findUnique({
    where: { id: params.groupId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      notificationChannelId: true,
      notificationTargets: { select: { kind: true, channelId: true } },
    },
  });
  if (!group) notFound();

  const isOwner = group.ownerId === currentUser.id;
  const isAdmin = isAdminEmail(currentUser.email);
  if (!isOwner && !isAdmin) notFound();
  const playLogMin = isAdmin ? await getPlayLogMinParticipants(group.id) : null;

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link
        href={`/groups/${group.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-steam-muted hover:text-steam-text"
      >
        <ArrowLeft size={16} aria-hidden="true" /> {group.name}に戻る
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-steam-text sm:text-3xl">グループの設定</h1>

      {isOwner && (
        <section className="mt-6 rounded-xl bg-steam-surface p-4">
          <NotificationSettings
            groupId={group.id}
            targets={group.notificationTargets}
            legacyChannelId={group.notificationChannelId}
          />
        </section>
      )}

      {playLogMin !== null && (
        <section className="mt-6 rounded-xl bg-steam-surface p-4">
          <h2 className="text-base font-bold text-steam-text">プレイ記録</h2>
          <p className="mt-1 text-sm text-steam-muted">
            1人用のテストグループで動きを確かめるときだけ1人にします。
          </p>
          <div className="mt-3">
            <PlayLogMinParticipantsSetting groupId={group.id} initial={playLogMin} />
          </div>
        </section>
      )}

      {isOwner && (
        <section className="mt-6 rounded-xl bg-steam-surface p-4">
          <h2 className="text-base font-bold text-steam-text">グループの削除</h2>
          <p className="mt-1 text-sm text-steam-muted">
            元に戻せません。アルバムが残っているグループは削除できないので、先にアルバムを削除するか別のグループへ移してください。
          </p>
          <div className="mt-3">
            <DeleteGroupButton groupId={group.id} />
          </div>
        </section>
      )}
    </main>
  );
}
