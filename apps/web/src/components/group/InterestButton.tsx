"use client";

import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export type InterestUser = { id: string; name: string };

// ウォッチリストの「ねらってる」マーク（2026-10 のデザイン刷新で「気になる」から改名。ゲームの状態の「プレイ予定」と紛らわしかったため）。ゲームのステータス（グループとしての状態）とは別に、
// メンバーが個人の興味を軽く表明するためのもの。グループのゲームリストのカードと
// ゲーム詳細ページの両方から使う（詳細ページでは showNames で誰がねらっているかも出す）。
export function InterestButton({
  groupId,
  gameId,
  users,
  currentUserId,
  showNames = false,
}: {
  groupId: string;
  gameId: string;
  users: InterestUser[];
  currentUserId: string;
  showNames?: boolean;
}) {
  const [localUsers, setLocalUsers] = useState(users);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setLocalUsers(users), [users]);

  const mine = localUsers.some((u) => u.id === currentUserId);

  async function toggle(e: React.MouseEvent) {
    // カード全体がリンクになっている配置でも、このボタンでは遷移させない
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    const previous = localUsers;
    setLocalUsers(
      mine
        ? previous.filter((u) => u.id !== currentUserId)
        : [...previous, { id: currentUserId, name: "あなた" }]
    );
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}/interest`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      // 他の楽観的更新と違いrouter.refresh()はしない。ゲーム詳細ページの再レンダリングは
      // Steam（レビュー/レビュー本文/価格/ニュース）とIsThereAnyDealへの外部問い合わせを
      // まとめて走らせ直すため、マークの付け外しごとにやるには重すぎる。
      // 変わるのは自分の分だけなので、ローカルの状態がそのまま正しい結果になる。
    } catch {
      setLocalUsers(previous);
      setError("更新に失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={showNames ? "" : "flex min-w-0 flex-col items-end"}>
      <button
        onClick={toggle}
        disabled={pending}
        title={mine ? "ねらってるを取り消す" : "ねらってる！"}
        aria-pressed={mine}
        aria-label={`ねらってる（${localUsers.length}人）`}
        className={`flex flex-shrink-0 items-center gap-1 rounded-sm border px-1.5 py-1 text-3xs transition disabled:opacity-50 ${
          mine
            ? "border-steam-blue/60 text-steam-blue"
            : "border-steam-border text-steam-muted hover:border-steam-blue"
        }`}
      >
        {pending ? <Spinner size={10} /> : <Bookmark size={12} fill={mine ? "currentColor" : "none"} />}
        <span>ねらってる</span>
        {localUsers.length > 0 && <span className="font-num">{localUsers.length}</span>}
      </button>

      {showNames && localUsers.length > 0 && (
        <p className="mt-1.5 text-3xs text-steam-muted">
          ねらってる: {localUsers.map((u) => u.name).join("、")}
        </p>
      )}
      {error && <p className="mt-1 text-4xs text-danger">{error}</p>}
    </div>
  );
}
