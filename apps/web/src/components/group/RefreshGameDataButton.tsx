"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * ゲーム詳細の外部情報（Steamレビュー/価格/ニュース、IsThereAnyDealの最安値、
 * YouTube動画、HowLongToBeat）を取り直すボタン。
 *
 * 更新間隔はサーバー側で判定する（ここでの日時表示はあくまで目安で、
 * ボタンを押せてもサーバーが429で断ることがある。その場合はメッセージを出す）。
 */
export function RefreshGameDataButton({
  groupId,
  gameId,
  refreshedAt,
  nextAvailableAt,
  canRefresh,
}: {
  groupId: string;
  gameId: string;
  refreshedAt: string | null;
  nextAvailableAt: string | null;
  canRefresh: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState(refreshedAt);
  const [availableAt, setAvailableAt] = useState(nextAvailableAt);

  useEffect(() => setLastRefreshed(refreshedAt), [refreshedAt]);
  useEffect(() => setAvailableAt(nextAvailableAt), [nextAvailableAt]);

  const waiting = availableAt !== null && new Date(availableAt).getTime() > Date.now();

  async function refresh() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}/refresh`, { method: "POST" });
      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        // 他のメンバーが直前に更新した場合などにここへ来る
        if (data?.refreshedAt) setLastRefreshed(data.refreshedAt);
        if (data?.nextAvailableAt) setAvailableAt(data.nextAvailableAt);
        setMessage(data?.error ?? "しばらく待ってから試してください。");
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "更新に失敗しました");

      if (data?.refreshedAt) setLastRefreshed(data.refreshedAt);
      if (data?.nextAvailableAt) setAvailableAt(data.nextAvailableAt);
      // 一部のソースが取れていない場合に「更新しました」だけ出すと、
      // 何も変わっていないのに成功したように見えてしまう
      const missing: string[] = Array.isArray(data?.missing) ? data.missing : [];
      setMessage(
        missing.length > 0
          ? `更新しました（${missing.join("・")}の情報は取得できませんでした）`
          : "最新の情報に更新しました。"
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setPending(false);
    }
  }

  if (!canRefresh) {
    return lastRefreshed ? (
      <p className="font-mono text-3xs text-steam-muted/70">
        情報の最終更新: {formatWhen(lastRefreshed)}
      </p>
    ) : null;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={refresh}
          disabled={pending || waiting}
          title={
            waiting && availableAt
              ? `次に更新できるのは ${formatWhen(availableAt)} 以降です`
              : "Steam・IsThereAnyDeal・YouTube・HowLongToBeatの情報を取り直す"
          }
          className="inline-flex items-center gap-1.5 rounded-sm border border-steam-border px-2.5 py-1.5 font-mono text-3xs text-steam-text transition hover:border-steam-blue disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Spinner size={11} /> : <RefreshCw size={11} />}
          {pending ? "更新中…" : "情報を更新"}
        </button>

        {lastRefreshed && (
          <span className="font-mono text-3xs text-steam-muted/70">
            最終更新: {formatWhen(lastRefreshed)}
          </span>
        )}
      </div>

      {waiting && availableAt && !message && (
        <p className="mt-1 font-mono text-4xs text-steam-muted/60">
          次に更新できるのは {formatWhen(availableAt)} 以降です（1日1回まで）
        </p>
      )}
      {message && <p className="mt-1 font-mono text-4xs text-steam-muted">{message}</p>}
    </div>
  );
}
