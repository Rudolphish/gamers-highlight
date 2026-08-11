"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Send } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * エラー通知の投稿先DiscordチャンネルIDの設定。
 *
 * グループの通知設定と違いサーバー（guild）が特定できないため、
 * チャンネル一覧のプルダウンは出せずID直接入力にしている。
 * IDが正しくてもBotが居ない・権限が無ければ届かないので、テスト投稿を用意した。
 */
export function ErrorNotifySetting({ channelId }: { channelId: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(channelId ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/error-notify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "保存に失敗しました");
      setMessage(draft.trim() ? "保存しました。" : "通知を解除しました。");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/error-notify", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "テスト投稿に失敗しました");
      setMessage("テストメッセージを投稿しました。Discordを確認してください。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "テスト投稿に失敗しました");
    } finally {
      setTesting(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="mt-4 flex flex-col gap-3 rounded-sm border border-steam-border bg-steam-surface p-4"
    >
      <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <Bell size={12} /> 通知先（Discord）
      </h2>

      <div>
        <label className="font-mono text-2xs text-steam-muted">チャンネルID</label>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="123456789012345678"
          inputMode="numeric"
          className="mt-1 w-full max-w-md rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue"
        />
        <p className="mt-1 font-mono text-3xs text-steam-muted/70">
          Discordの「開発者モード」をONにして、通知したいチャンネルを右クリック →
          「チャンネルIDをコピー」で取得できます。空にすると通知を止めます（記録は続きます）。
          <br />
          Botがそのサーバーに参加していて、そのチャンネルに投稿できる必要があります。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
        >
          {saving ? <Spinner size={12} /> : <Check size={13} />} 保存
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing || !channelId}
          title={channelId ? "保存済みのチャンネルへテスト投稿します" : "先に保存してください"}
          className="inline-flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text transition hover:border-steam-blue disabled:opacity-40"
        >
          {testing ? <Spinner size={12} /> : <Send size={13} />} テスト投稿
        </button>
      </div>

      {message && <p className="font-mono text-3xs text-[#a4d007]">{message}</p>}
      {error && <p className="font-mono text-3xs text-[#eb4b4b]">{error}</p>}
    </form>
  );
}
