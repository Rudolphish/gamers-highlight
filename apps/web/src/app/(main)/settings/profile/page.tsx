"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { User, Check, AlertCircle } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { primaryButton } from "@/components/ui/buttonStyles";
import { THEME_COLORS, resolveThemeColor, themeCss, type ThemeColorId } from "@/lib/themeColors";

export default function ProfileSettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 保存したらログイン情報の名前も更新する（PCの左下のアカウントに出る名前。値はサーバーがDBから読み直す。lib/auth.ts）
  const { update: updateSession } = useSession();
  const router = useRouter();
  // テーマの色。選んだ瞬間に保存する（表示名の「変更を保存」とは別）
  const [themeColor, setThemeColor] = useState<ThemeColorId | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setName(data.user.name ?? "");
          setEmail(data.user.email ?? "");
          setThemeColor(resolveThemeColor(data.user.themeColor));
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
        await updateSession();
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

  // 色を選んだら保存して、ログイン情報の色も読み直してもらい（lib/auth.ts）、レイアウトを描き直す。
  // 描き直しを待つ間は、下の <style> でこの画面だけ先に新しい色にしておく
  async function chooseTheme(next: ThemeColorId) {
    if (next === themeColor || themeSaving) return;
    const previous = themeColor;
    setThemeColor(next);
    setThemeSaving(true);
    setThemeError(null);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeColor: next }),
      });
      if (!res.ok) throw new Error();
      await updateSession();
      router.refresh();
    } catch {
      setThemeColor(previous);
      setThemeError("テーマの色を変えられませんでした");
    } finally {
      setThemeSaving(false);
    }
  }

  return (
    <main className="p-4 sm:p-6 max-w-2xl">
      {themeColor && <style data-theme-preview={themeColor} dangerouslySetInnerHTML={{ __html: themeCss(themeColor) }} />}
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        プロフィール設定
      </h1>
      <SettingsNav />
      <p className="mt-4 text-xs text-steam-muted">
        表示名とテーマの色を変えられます
      </p>

      {loading ? (
        <p className="mt-6 text-xs text-steam-muted">読み込み中…</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 rounded-xl bg-steam-surface p-4">
          <div>
            <label className="text-2xs text-steam-muted">メールアドレス（変更不可）</label>
            <input
              type="text"
              value={email}
              disabled
              className="mt-1 w-full rounded-lg border border-steam-border bg-steam-bg/50 px-3 py-2 text-sm text-steam-muted outline-none cursor-not-allowed"
            />
          </div>

          <div>
            <label className="text-2xs text-steam-muted">表示名</label>
            <div className="relative mt-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="表示名を入力"
                disabled={saving}
                className="w-full rounded-lg border border-steam-border bg-steam-bg px-3 py-2 pl-9 text-sm text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <User size={16} className="absolute left-3 top-2.5 text-steam-muted" />
            </div>
          </div>

          {message && (
            <div
              className={`flex items-center gap-2 rounded-sm p-3 text-xs ${
                message.type === "success"
                  ? "bg-positive/10 text-positive border border-positive/30"
                  : "bg-danger/10 text-danger border border-danger/30"
              }`}
            >
              {message.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className={`${primaryButton} mt-2 w-full`}
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        </form>
      )}

      {!loading && themeColor && (
        <section aria-labelledby="theme-color-heading" className="mt-6 rounded-xl bg-steam-surface p-4">
          <h2 id="theme-color-heading" className="text-sm font-bold text-steam-text">
            テーマの色
          </h2>
          <p className="mt-1 text-2xs text-steam-muted">
            ボタンや選ばれている項目、ロゴのマークの色が変わります。選ぶとすぐに保存されます（このアカウントのどの端末でも同じ色になります）
          </p>
          <div role="radiogroup" aria-labelledby="theme-color-heading" className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {THEME_COLORS.map((t) => {
              const selected = t.id === themeColor;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-theme-option={t.id}
                  disabled={themeSaving}
                  onClick={() => chooseTheme(t.id)}
                  className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-2xs transition disabled:cursor-wait ${
                    selected ? "border-steam-text/60 bg-steam-panel text-steam-text" : "border-steam-border text-steam-muted hover:bg-steam-panel"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-accent-ink"
                    style={{ backgroundColor: t.accent }}
                  >
                    {selected && <Check size={16} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
          {themeError && (
            <div className="mt-3 flex items-center gap-2 rounded-sm border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} />
              {themeError}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
