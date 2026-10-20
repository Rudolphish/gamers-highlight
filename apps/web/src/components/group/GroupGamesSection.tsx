"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { GroupGameList } from "@/components/group/GroupGameList";

// グループ画面の「みんなのゲーム」。**「ゲームを追加」を見出しの横に置く**（2026-10-18 ユーザー判断。
// アルバムの「新規アルバム」・ウィッシュリストの「追加する」と同じ位置に揃えた）。
//
// 検索モーダルとその中身（検索語・結果・楽観的な追加）は今までどおり GroupGameList が持ち、
// ここは「区画が開いているか」と「モーダルが開いているか」だけを持つ。
// **区画を畳んだまま押されたら、先に開く。** 畳んでいる間は GroupGameList が描かれていないので、
// 開かずにモーダルだけ開けても何も出ない。
export function GroupGamesSection({
  children,
  ...listProps
}: Omit<ComponentProps<typeof GroupGameList>, "addOpen" | "onAddOpenChange"> & {
  /** 一覧の上に出すもの（結びついていないプレイ記録・プレイ中の集計） */
  children?: ReactNode;
}) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <CollapsibleSection
      title="みんなのゲーム"
      open={sectionOpen}
      onOpenChange={setSectionOpen}
      headerAction={
        listProps.canEdit && (
          <button
            onClick={() => {
              setSectionOpen(true);
              setAddOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-bold text-accent-ink"
          >
            <Plus size={14} /> ゲームを追加
          </button>
        )
      }
    >
      {children}
      <GroupGameList {...listProps} addOpen={addOpen} onAddOpenChange={setAddOpen} />
    </CollapsibleSection>
  );
}
