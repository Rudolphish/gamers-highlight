"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Send } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * 週次まとめの投稿先チャンネルの設定と、手動送信。
 *
 * エラー通知の設定（ErrorNotifySetting）と同じ作り。サーバー（guild）が特定できないので
 * プルダウンは出せずID直接入力。IDが正しくてもBotが居ない・権限が無ければ届かないため、
 * 実際に送ってみる手段を用意してある。
 *
 * **「いま送る」は確認用で、その週を送信済みにはしない。** 自動送信は
 * 「未送信の完了週があるか」で判定するので、手で送っても自動送信は別に走る。
 *
 * **送るのは全グループぶん**（自動送信と同じ）。画面のプレビューは1グループだけを
 * 出しているが、ここで送るのは「cronが送るのと同じもの」でないと確認にならない。
 */
export function WeeklyNotifySetting({
  channelId,
  week,
  weekLabel,
}: {
  channelId: string | null;
  week: number;
  weekLabel: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(channelId ?? "");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/weekly-notify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "保存に失敗しました");
      setMessage(draft.trim() ? "保存しました。" : "通知を止めました。");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    if (sending) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/weekly-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "送信に失敗しました");
      setMessage(
        data?.posted > 0
          ? `${data.posted}件のグループぶんを投稿しました。Discordを確認してください。`
          : (data?.note ?? "送信しませんでした。")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(false);
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
          週が終わると、次に日次ジョブが動いたタイミングでここへ投稿します（曜日は問いません）。
          動きが無かった週は送りません。空にすると止まります。
          <br />
          グループの通知先とも、エラー通知先とも別に持っています。
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
          onClick={sendNow}
          disabled={sending || !channelId}
          title={
            channelId
              ? "自動送信と同じものを送ります（動きがあったグループぶん、まとめて）"
              : "先に保存してください"
          }
          className="inline-flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text transition hover:border-steam-blue disabled:opacity-40"
        >
          {sending ? <Spinner size={12} /> : <Send size={13} />} {weekLabel} を今すぐ送る
        </button>
      </div>

      {message && <p className="font-mono text-3xs text-[#a4d007]">{message}</p>}
      {error && <p className="font-mono text-3xs text-[#eb4b4b]">{error}</p>}
    </form>
  );
}
