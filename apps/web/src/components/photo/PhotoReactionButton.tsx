"use client";

import { useState } from "react";
import { Heart } from "lucide-react";

export type ReactionState = {
  count: number;
  reacted: boolean;
  /** 押した人の表示名。Lightboxでのみ出す */
  names: string[];
};

/**
 * 写真への❤️ボタン。押すたびにトグルする。
 *
 * **押した瞬間に表示を変えてから通信する（楽観更新）。** 反応は連打されるものなので、
 * 往復を待って光らせると押した気がしない。失敗したら元に戻す。
 *
 * 名前の一覧は渡された時点のもので、自分が押した分だけこの場で足し引きする
 * （他の人の増減はページを開き直したときに反映される。リアクションはキャッシュしていないので、
 *   次に開けば必ず最新になる）。
 */
export function PhotoReactionButton({
  photoId,
  initial,
  currentUserName,
  showNames = false,
  size = "sm",
  onChange,
}: {
  photoId: string;
  initial: ReactionState;
  currentUserName?: string | null;
  showNames?: boolean;
  size?: "sm" | "lg";
  onChange?: (next: ReactionState) => void;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // グリッド上ではカード自体がLightboxを開くので、押下をここで止める
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    const before = state;
    const me = currentUserName ?? "あなた";
    const next: ReactionState = before.reacted
      ? {
          count: before.count - 1,
          reacted: false,
          names: before.names.filter((n) => n !== me),
        }
      : { count: before.count + 1, reacted: true, names: [...before.names, me] };

    setState(next);
    onChange?.(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/photos/${photoId}/reactions`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { count: number; reacted: boolean };
      // サーバーの数を正とする（他の人が同時に押していた場合にずれるため）
      setState((s) => {
        const synced = { ...s, count: json.count, reacted: json.reacted };
        onChange?.(synced);
        return synced;
      });
    } catch {
      setState(before);
      onChange?.(before);
    } finally {
      setBusy(false);
    }
  }

  const iconSize = size === "lg" ? 20 : 12;

  return (
    <div className={showNames ? "space-y-1" : undefined}>
      <button
        onClick={toggle}
        aria-pressed={state.reacted}
        aria-label={state.reacted ? "リアクションを取り消す" : "リアクションする"}
        className={`inline-flex items-center gap-1 rounded-sm border font-mono transition ${
          size === "lg" ? "px-2.5 py-1.5 text-xs" : "px-1.5 py-0.5 text-3xs"
        } ${
          state.reacted
            ? "border-[#e05a5a]/60 bg-steam-bg/80 text-[#e05a5a]"
            : "border-steam-border bg-steam-bg/80 text-steam-muted hover:border-[#e05a5a]/60 hover:text-[#e05a5a]"
        }`}
      >
        <Heart size={iconSize} fill={state.reacted ? "currentColor" : "none"} />
        {state.count > 0 && <span>{state.count}</span>}
      </button>

      {showNames && state.names.length > 0 && (
        <p className="font-mono text-3xs text-steam-muted">{state.names.join("、")}</p>
      )}
    </div>
  );
}
