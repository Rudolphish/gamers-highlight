"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * メディア一覧からの削除。押し間違いが致命的（ストレージの実体まで消え、元に戻せない）なので、
 * 一度で消さず確認の一段を挟む。window.confirmを使わないのは、
 * サムネイル表示だと「どれを消そうとしているか」が文言だけでは分からないため。
 */
export function DeleteMediaButton({
  photoId,
  label,
  compact = false,
}: {
  photoId: string;
  /** 確認時に何を消すのか分かるように出す名前 */
  label: string;
  /** サムネイル表示のカード上に重ねる小さい見た目にするか */
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "削除に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (error) {
    return (
      <span className="font-mono text-4xs text-[#eb4b4b]" title={error}>
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        aria-label={`${label} を削除`}
        title={`${label} を削除`}
        className={`flex-shrink-0 text-steam-muted transition hover:text-[#eb4b4b] ${
          compact ? "rounded-sm bg-black/60 p-1.5 backdrop-blur-sm" : "p-1.5"
        }`}
      >
        <Trash2 size={compact ? 11 : 12} />
      </button>
    );
  }

  return (
    <span
      className={`flex flex-shrink-0 items-center gap-0.5 ${
        compact ? "rounded-sm bg-black/70 px-1 py-0.5 backdrop-blur-sm" : ""
      }`}
    >
      <button
        onClick={remove}
        disabled={deleting}
        aria-label="削除を実行"
        title={`${label} を完全に削除する`}
        className="p-1 text-[#eb4b4b] transition hover:text-[#ff6b6b] disabled:opacity-50"
      >
        {deleting ? <Spinner size={11} /> : <Check size={12} />}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={deleting}
        aria-label="削除を取り消す"
        className="p-1 text-steam-muted transition hover:text-steam-text disabled:opacity-50"
      >
        <X size={12} />
      </button>
    </span>
  );
}
