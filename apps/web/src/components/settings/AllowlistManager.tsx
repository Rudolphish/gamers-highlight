"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle2, Clock } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type Entry = {
  id: string;
  discordUserId: string | null;
  email: string | null;
  note: string | null;
  /** 登録後、実際に一度でもログインしたか（していないとグループに招待できない） */
  signedIn: boolean;
};

// 許可リスト（このアプリにログインできる人）の管理UI。
// 以前は packages/db/seed-allowlist.ts を書き換えて実行するしか手段が無かった。
export function AllowlistManager() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [discordUserId, setDiscordUserId] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/allowlist");
      if (!res.ok) throw new Error("許可リストの取得に失敗しました");
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "許可リストの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId, email, note }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "追加に失敗しました");
      setDiscordUserId("");
      setEmail("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/allowlist/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "削除に失敗しました");
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-6 max-w-2xl">
      <form
        onSubmit={add}
        className="flex flex-col gap-3 rounded-sm border border-steam-border bg-steam-surface p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="font-mono text-2xs text-steam-muted">DiscordユーザーID</label>
            <input
              value={discordUserId}
              onChange={(e) => setDiscordUserId(e.target.value)}
              placeholder="123456789012345678"
              inputMode="numeric"
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
          <div>
            <label className="font-mono text-2xs text-steam-muted">メールアドレス</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
            />
          </div>
        </div>
        <div>
          <label className="font-mono text-2xs text-steam-muted">メモ（誰なのか分かるように）</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="たける"
            className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
          />
        </div>
        <p className="font-mono text-3xs text-steam-muted/70">
          DiscordユーザーIDは、Discordの「開発者モード」をONにしてユーザーを右クリック →
          「ユーザーIDをコピー」で取得できます。どちらか一方でも登録できます。
        </p>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {saving ? <Spinner size={12} /> : <Plus size={13} />} 許可リストに追加
        </button>
      </form>

      {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="font-mono text-xs text-steam-muted">読み込み中…</p>
        ) : entries.length === 0 ? (
          <p className="font-mono text-xs text-steam-muted">まだ誰も登録されていません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-sm border border-steam-border bg-steam-panel px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-steam-text">
                    {entry.note || entry.email || entry.discordUserId}
                  </p>
                  <p className="truncate font-mono text-4xs text-steam-muted/70">
                    {[entry.discordUserId && `Discord: ${entry.discordUserId}`, entry.email]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                </div>

                {entry.signedIn ? (
                  <span className="flex flex-shrink-0 items-center gap-1 font-mono text-4xs text-[#a4d007]">
                    <CheckCircle2 size={11} /> ログイン済み
                  </span>
                ) : (
                  <span
                    className="flex flex-shrink-0 items-center gap-1 font-mono text-4xs text-steam-muted"
                    title="本人が一度ログインするまでグループに招待できません"
                  >
                    <Clock size={11} /> 未ログイン
                  </span>
                )}

                <button
                  onClick={() => remove(entry.id)}
                  disabled={deletingId === entry.id}
                  aria-label="許可リストから外す"
                  className="flex-shrink-0 p-1.5 text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
                >
                  {deletingId === entry.id ? <Spinner size={12} /> : <Trash2 size={12} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 font-mono text-3xs text-steam-muted/70">
        新しいメンバーの導線：① ここに追加 → ② 本人がDiscordでログイン → ③
        グループの「メンバー」から招待。②を挟まないと招待候補に出てきません。
      </p>
    </div>
  );
}
