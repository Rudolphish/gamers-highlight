"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

// グループ画面の4つの区画の並べ方（2026-10 のデザイン刷新・段階5）。
//
// - スマホ（768px未満）: 「ようす・アルバム・ゲーム・ウィッシュ」のタブで1つずつ出す。
//   以前は全部を縦に積んでいて、ウィッシュリストまで指で長々と送る必要があった
// - 768〜1279px: タブを出さず、4つを縦に並べる（ようす → アルバム → ゲーム → ウィッシュ）
// - 1280px以上: 2列。左にアルバムとゲーム（大きい）、右にようすとウィッシュリスト（幅340px）
//
// **区画はサーバーで全部描き、選ばれていないタブは CSS で隠すだけにする。** 中身を出し分けると、
// タブを切り替えるたびにサーバーへ取りに行くことになり、HTMLを見ているテストからも区画が消える。
//
// **タブは URL（?tab=）に持たせる。** 押したら履歴に積むので、戻るボタンで前のタブに戻り、
// URLを共有すれば同じタブが開く。Next.js 14.1 からは history.pushState が useSearchParams に反映される。
// 「ようす」は既定なので URL から消す（グループのURLがいつも同じ形で済む）。
//
// 並べ替えは `order` で行う。2列のときの左右の箱は、1列のときは `display: contents` で消えて、
// 中の区画が直接ここのフレックスの子になる（DOMを2通り持たずに済む）
export const GROUP_TABS = [
  { key: "overview", label: "ようす" },
  { key: "albums", label: "アルバム" },
  { key: "games", label: "ゲーム" },
  { key: "wishlist", label: "ウィッシュ" },
] as const;
export type GroupTabKey = (typeof GROUP_TABS)[number]["key"];

function toTab(value: string | null): GroupTabKey {
  return GROUP_TABS.some((t) => t.key === value) ? (value as GroupTabKey) : "overview";
}

export function GroupSections({
  overview,
  albums,
  games,
  wishlist,
}: Record<GroupTabKey, ReactNode>) {
  const tab = toTab(useSearchParams().get("tab"));

  function select(key: GroupTabKey) {
    if (key === tab) return;
    const url = new URL(window.location.href);
    if (key === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.pushState(null, "", url);
  }

  const section = (key: GroupTabKey, node: ReactNode, order: string) => (
    <section
      id={`group-tab-${key}`}
      role="tabpanel"
      aria-labelledby={`group-tab-button-${key}`}
      data-tab={key}
      className={`${tab === key ? "block" : "hidden"} min-w-0 md:block ${order}`}
    >
      {node}
    </section>
  );

  return (
    <div className="mt-5">
      <div role="tablist" aria-label="グループの中身" className="mb-5 grid grid-cols-4 gap-1 rounded-full bg-steam-surface p-1 md:hidden">
        {GROUP_TABS.map((t) => (
          <button
            key={t.key}
            id={`group-tab-button-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`group-tab-${t.key}`}
            onClick={() => select(t.key)}
            className={`h-11 rounded-full text-sm transition ${
              tab === t.key ? "bg-steam-panel font-bold text-steam-text" : "text-steam-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-8">
          {section("albums", albums, "order-2")}
          {section("games", games, "order-3")}
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-8">
          {section("overview", overview, "order-1")}
          {section("wishlist", wishlist, "order-4")}
        </div>
      </div>
    </div>
  );
}
