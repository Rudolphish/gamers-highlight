"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { fieldClass } from "@/components/ui/buttonStyles";

/**
 * プレイ記録の最少人数（管理者だけに出す）。1人用のテストグループで実際の動きを確かめるためのもの。
 * 保存先とBotへの届き方は `api/groups/[id]/play-log/settings` の説明を参照。
 */
export function PlayLogMinParticipantsSetting({ groupId, initial }: { groupId: string; initial: 1 | 2 }) {
  const [value, setValue] = useState<1 | 2>(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function change(next: 1 | 2) {
    const previous = value;
    setValue(next);
    setStatus("saving");
    const res = await fetch(`/api/groups/${groupId}/play-log/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minParticipants: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setValue(previous);
      setStatus("error");
      return;
    }
    setStatus("saved");
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-2 text-sm text-steam-muted">
      <FlaskConical size={14} aria-hidden />
      <label htmlFor={`playlog-min-${groupId}`}>プレイ記録の最少人数（管理者のみ）</label>
      <select
        id={`playlog-min-${groupId}`}
        value={value}
        disabled={status === "saving"}
        onChange={(e) => change(Number(e.target.value) === 1 ? 1 : 2)}
        className={fieldClass}
      >
        <option value={2}>2人（通常）</option>
        <option value={1}>1人（動作確認用）</option>
      </select>
      {status === "saved" && <span>保存しました（Botに届くまで最大15分）</span>}
      {status === "error" && <span className="text-danger">保存に失敗しました</span>}
    </div>
  );
}
