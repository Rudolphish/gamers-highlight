"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type InviteUse = { id: string; usedAt: string; user: { name: string | null; email: string | null } };

type Invite = {
  id: string;
  token: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
  uses: InviteUse[];
};

const ROLE_LABEL = { OWNER: "オーナー", EDITOR: "編集者", VIEWER: "閲覧者" } as const;

function statusOf(i: Invite): { label: string; className: string } {
  if (i.revokedAt) return { label: "取り消し済み", className: "text-steam-muted/60" };
  if (new Date(i.expiresAt).getTime() <= Date.now())
    return { label: "期限切れ", className: "text-steam-muted/60" };
  if (i.usedCount >= i.maxUses) return { label: "使用済み", className: "text-steam-muted" };
  return { label: "有効", className: "text-[#a4d007]" };
}

/**
 * グループへの招待リンクの発行・一覧・取り消し（OWNERのみ表示される）。
 *
 * 既存の招待（登録済みユーザーをプルダウンから選ぶ）と違い、このリンクは
 * **未登録の相手にも送れる**。受け取った人はDiscordログインするだけで、
 * 許可リストへの登録とグループ加入がまとめて行われる。
 */
export function GroupInviteLinks({ groupId }: { groupId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [maxUses, setMaxUses] = useState(1);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invites`);
      if (!res.ok) throw new Error("招待リンクの取得に失敗しました");
      setInvites((await res.json()).invites ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "招待リンクの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, expiresInHours, maxUses }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "発行に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/invites/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("取り消しに失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setRevokingId(null);
    }
  }

  async function copy(invite: Invite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("コピーできませんでした。リンクを手動で選択してください。");
    }
  }

  return (
    <div className="mt-4 border-t border-steam-border pt-4">
      <h3 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <Link2 size={12} /> 招待リンク
      </h3>
      <p className="mt-1 font-mono text-4xs text-steam-muted/70">
        まだこのアプリを使っていない友人にも送れます。受け取った人はDiscordでログインするだけで参加できます。
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-4xs text-steam-muted">権限</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "EDITOR" | "VIEWER")}
            className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1.5 font-mono text-3xs text-steam-text outline-none focus:border-steam-blue"
          >
            <option value="VIEWER">閲覧者</option>
            <option value="EDITOR">編集者</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-4xs text-steam-muted">有効期限</span>
          <select
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
            className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1.5 font-mono text-3xs text-steam-text outline-none focus:border-steam-blue"
          >
            <option value={24}>24時間</option>
            <option value={72}>72時間</option>
            <option value={168}>7日</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-4xs text-steam-muted">使える回数</span>
          <select
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            className="rounded-sm border border-steam-border bg-steam-bg px-2 py-1.5 font-mono text-3xs text-steam-text outline-none focus:border-steam-blue"
          >
            <option value={1}>1回</option>
            <option value={3}>3回</option>
            <option value={5}>5回</option>
          </select>
        </label>

        <button
          onClick={create}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-3xs font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {creating ? <Spinner size={11} /> : <Link2 size={12} />} リンクを発行
        </button>
      </div>

      {error && <p className="mt-2 font-mono text-3xs text-[#eb4b4b]">{error}</p>}

      <div className="mt-3 flex flex-col gap-2">
        {loading ? (
          <p className="font-mono text-3xs text-steam-muted">読み込み中…</p>
        ) : invites.length === 0 ? (
          <p className="font-mono text-3xs text-steam-muted/70">発行済みのリンクはありません。</p>
        ) : (
          invites.map((i) => {
            const status = statusOf(i);
            const active = status.label === "有効";
            return (
              <div key={i.id} className="rounded-sm border border-steam-border bg-steam-panel p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-mono text-4xs ${status.className}`}>{status.label}</span>
                  <span className="font-mono text-4xs text-steam-muted/70">
                    {ROLE_LABEL[i.role]}・{i.usedCount}/{i.maxUses}回・
                    {new Date(i.expiresAt).toLocaleString("ja-JP")}まで
                  </span>

                  <span className="ml-auto flex items-center gap-1">
                    {active && (
                      <button
                        onClick={() => copy(i)}
                        title="リンクをコピー"
                        aria-label="リンクをコピー"
                        className="p-1.5 text-steam-muted transition hover:text-steam-blue"
                      >
                        {copiedId === i.id ? (
                          <Check size={12} className="text-[#a4d007]" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    )}
                    {!i.revokedAt && (
                      <button
                        onClick={() => revoke(i.id)}
                        disabled={revokingId === i.id}
                        title="このリンクを取り消す"
                        aria-label="このリンクを取り消す"
                        className="p-1.5 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
                      >
                        {revokingId === i.id ? <Spinner size={11} /> : <Trash2 size={11} />}
                      </button>
                    )}
                  </span>
                </div>

                {i.uses.length > 0 && (
                  <p className="mt-1 font-mono text-4xs text-steam-muted/70">
                    参加:{" "}
                    {i.uses
                      .map(
                        (u) =>
                          `${u.user.name ?? u.user.email ?? "メンバー"}（${new Date(
                            u.usedAt
                          ).toLocaleDateString("ja-JP")}）`
                      )
                      .join("、")}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
