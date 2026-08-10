"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export type InterestUser = { id: string; name: string };

// ウォッチリストの「気になってる」マーク。ゲームのステータス（グループとしての状態）とは別に、
// メンバーが個人の興味を軽く表明するためのもの。グループのゲームリストのカードと
// ゲーム詳細ページの両方から使う（詳細ページでは showNames で誰が気になっているかも出す）。
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
        title={mine ? "気になるを取り消す" : "気になる！"}
        aria-pressed={mine}
        aria-label={`気になってる（${localUsers.length}人）`}
        className={`flex flex-shrink-0 items-center gap-1 rounded-sm border px-1.5 py-1 font-mono text-[10px] transition disabled:opacity-50 ${
          mine
            ? "border-[#a4d007]/60 text-[#a4d007]"
            : "border-steam-border text-steam-muted hover:border-steam-blue"
        }`}
      >
        {pending ? <Spinner size={10} /> : <Eye size={11} />}
        {localUsers.length}
      </button>

      {showNames && localUsers.length > 0 && (
        <p className="mt-1.5 font-mono text-[10px] text-steam-muted">
          気になってる: {localUsers.map((u) => u.name).join("、")}
        </p>
      )}
      {error && <p className="mt-1 font-mono text-[9px] text-[#eb4b4b]">{error}</p>}
    </div>
  );
}
