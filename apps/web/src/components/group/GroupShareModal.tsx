"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Users, X, UserPlus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { GroupInviteLinks } from "@/components/group/GroupInviteLinks";

type Member = {
  userId: string;
  name?: string | null;
  avatarUrl?: string | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
  isOwner: boolean;
};

type Candidate = { id: string; name?: string | null; email?: string | null };

type GroupShareModalProps = {
  groupId: string;
  isOwner: boolean;
  members: Member[];
  candidates: Candidate[]; // まだメンバーではない、招待可能なユーザー
};

const ROLE_LABEL: Record<Member["role"], string> = {
  OWNER: "オーナー",
  EDITOR: "編集者",
  VIEWER: "閲覧者",
};

export function GroupShareModal({ groupId, isOwner, members, candidates }: GroupShareModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inviteeId, setInviteeId] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [inviting, setInviting] = useState(false);
  const [roleChangingUserId, setRoleChangingUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 同時に複数の操作を走らせないよう、いずれか進行中は全体の操作を止める
  const pending = inviting || roleChangingUserId !== null || removingUserId !== null;

  async function handleInvite() {
    const candidate = candidates.find((c) => c.id === inviteeId);
    if (!candidate?.email) {
      setError("このユーザーはメールアドレス未登録のため招待できません");
      return;
    }
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: candidate.email, role: inviteRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInviteeId("");
      router.refresh();
    } catch {
      setError("招待に失敗しました");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(userId: string, role: "EDITOR" | "VIEWER") {
    setRoleChangingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("権限の変更に失敗しました");
    } finally {
      setRoleChangingUserId(null);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setError("メンバーの削除に失敗しました");
    } finally {
      setRemovingUserId(null);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text hover:border-steam-blue"
      >
        <Users size={13} /> メンバー
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">グループメンバー管理</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="p-2 text-steam-muted hover:text-steam-text"
              >
                <X size={16} />
              </button>
            </div>

            <ul className="mt-4 flex flex-col gap-2">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-2 rounded-sm border border-steam-border bg-steam-panel px-3 py-2"
                >
                  <div className="h-6 w-6 flex-shrink-0 overflow-hidden rounded-full bg-steam-surface">
                    {m.avatarUrl ? (
                      <Image src={m.avatarUrl} alt="" width={24} height={24} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-4xs text-steam-muted">
                        {(m.name ?? "?").slice(0, 1)}
                      </div>
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">
                    {m.name ?? "unknown"}
                  </span>

                  {isOwner && !m.isOwner ? (
                    <>
                      {roleChangingUserId === m.userId && <Spinner size={12} className="text-steam-muted" />}
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.userId, e.target.value as "EDITOR" | "VIEWER")}
                        disabled={pending}
                        className="rounded-sm border border-steam-border bg-steam-bg px-1.5 py-1 font-mono text-3xs text-steam-text disabled:opacity-50"
                      >
                        <option value="EDITOR">編集者</option>
                        <option value="VIEWER">閲覧者</option>
                      </select>
                      <button
                        onClick={() => handleRemove(m.userId)}
                        disabled={pending}
                        className="flex items-center gap-1 font-mono text-3xs text-[#eb4b4b] disabled:opacity-50"
                      >
                        {removingUserId === m.userId && <Spinner size={10} />}
                        削除
                      </button>
                    </>
                  ) : (
                    <span className="font-mono text-3xs text-steam-muted">{ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && (
              <div className="mt-4 border-t border-steam-border pt-4">
                <p className="font-mono text-2xs text-steam-muted">新しいメンバーを招待</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select
                    value={inviteeId}
                    onChange={(e) => setInviteeId(e.target.value)}
                    disabled={pending}
                    className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text"
                  >
                    <option value="">ユーザーを選択</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name ?? c.email ?? c.id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "EDITOR" | "VIEWER")}
                    disabled={pending}
                    className="rounded-sm border border-steam-border bg-steam-bg px-2 py-2 font-mono text-xs text-steam-text"
                  >
                    <option value="VIEWER">閲覧者</option>
                    <option value="EDITOR">編集者</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    disabled={pending || !inviteeId}
                    className="flex flex-shrink-0 items-center justify-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
                  >
                    {inviting ? <Spinner size={12} /> : <UserPlus size={12} />}
                    {inviting ? "招待中…" : "招待"}
                  </button>
                </div>
                {candidates.length === 0 && (
                  <p className="mt-2 font-mono text-3xs text-steam-muted/70">
                    招待可能な未参加ユーザーがいません（まだ登録していない相手は下の招待リンクを使ってください）
                  </p>
                )}

                <GroupInviteLinks groupId={groupId} />
              </div>
            )}

            {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
