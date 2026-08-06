"use client";

import { useState, useEffect } from "react";
import { User, Check, AlertCircle } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function ProfileSettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setName(data.user.name ?? "");
          setEmail(data.user.email ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMessage({ type: "error", text: "表示名を入力してください" });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setName(data.user.name ?? "");
        setMessage({ type: "success", text: "プロフィールを更新しました" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "更新に失敗しました" });
      }
    } catch {
      setMessage({ type: "error", text: "エラーが発生しました" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="p-4 sm:p-6 max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        プロフィール設定
      </h1>
      <SettingsNav />
      <p className="mt-4 font-mono text-xs text-steam-muted">
        表示名の確認・変更を行えます
      </p>

      {loading ? (
        <p className="mt-6 font-mono text-xs text-steam-muted">読み込み中…</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-sm border border-steam-border bg-steam-surface p-4">
          <div>
            <label className="font-mono text-[11px] text-steam-muted">メールアドレス（変更不可）</label>
            <input
              type="text"
              value={email}
              disabled
              className="mt-1 w-full rounded-sm border border-steam-border bg-steam-bg/50 px-3 py-2 font-mono text-sm text-steam-muted outline-none cursor-not-allowed"
            />
          </div>

          <div>
            <label className="font-mono text-[11px] text-steam-muted">表示名</label>
            <div className="relative mt-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="表示名を入力"
                disabled={saving}
                className="w-full rounded-sm border border-steam-border bg-steam-bg px-3 py-2 pl-9 font-mono text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <User size={16} className="absolute left-3 top-2.5 text-steam-muted" />
            </div>
          </div>

          {message && (
            <div
              className={`flex items-center gap-2 rounded-sm p-3 font-mono text-xs ${
                message.type === "success"
                  ? "bg-[#a4d007]/10 text-[#a4d007] border border-[#a4d007]/30"
                  : "bg-[#eb4b4b]/10 text-[#eb4b4b] border border-[#eb4b4b]/30"
              }`}
            >
              {message.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="mt-2 w-full rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] py-2.5 font-mono text-sm font-bold text-[#0e1b12] disabled:opacity-40 hover:brightness-110 transition"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        </form>
      )}
    </main>
  );
}
