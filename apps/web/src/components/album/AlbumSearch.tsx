"use client";

import { useState } from "react";
import { Search, X, LayoutGrid, List } from "lucide-react";
import { AlbumGrid } from "./AlbumGrid";
import { AlbumRows } from "./AlbumRows";
import { chipButton, fieldClass, ghostIconButton } from "@/components/ui/buttonStyles";

type Member = { id: string; name?: string | null; avatarUrl?: string | null };

type Album = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  coverIsVideo?: boolean;
  photoCount: number;
  members: Member[];
  memberCount: number;
  updatedAt: Date | string;
  /** 表示用の「3時間前」。サーバーで作る（AlbumCard のコメント参照） */
  updatedLabel: string;
  groupName?: string | null;
  /** 絞り込み用。画面には出さない */
  gameTitle?: string | null;
  groupId?: string | null;
};

type View = "grid" | "list";

/**
 * アルバムの絞り込み付き一覧。
 *
 * ゲーム1本につきアルバム1つが基本なので、遊ぶゲームが増えると一覧はすぐ数十件になる
 * （実際に42件になった）。並び順は更新順なので古いものほど下に沈み、名前が分かっていても
 * 目で探すことになる。手元で絞れるようにする。
 *
 * **絞り込みは受け取り済みの配列に対して行う**ので、入力のたびに問い合わせは発生しない。
 * アルバム名だけでなくゲーム名でも引けるようにしているのは、Discordのタグから
 * 自動生成されたアルバムだと、アルバム名と表示上のゲーム名が食い違うことがあるため。
 */
export function AlbumSearch({ albums }: { albums: Album[] }) {
  const [query, setQuery] = useState("");
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [view, setView] = useState<View>("grid");

  const keyword = query.trim().toLowerCase();
  const filtered = albums.filter((a) => {
    if (groupId && a.groupId !== groupId) return false;
    if (onlyWithPhotos && a.photoCount === 0) return false;
    if (!keyword) return true;
    return (
      a.title.toLowerCase().includes(keyword) ||
      (a.gameTitle ?? "").toLowerCase().includes(keyword) ||
      (a.groupName ?? "").toLowerCase().includes(keyword)
    );
  });

  const emptyCount = albums.filter((a) => a.photoCount === 0).length;

  // 所属グループの選択肢。1つしか無いなら絞る意味が無いので出さない
  const groups = [
    ...new Map(
      albums
        .filter((a) => a.groupId && a.groupName)
        .map((a) => [a.groupId as string, a.groupName as string])
    ),
  ];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steam-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="アルバム名・ゲーム名で絞り込む"
            className={`${fieldClass} w-full pl-9 pr-11 md:pr-9`}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="絞り込みを消す"
              className={`${ghostIconButton} absolute right-0 top-1/2 -translate-y-1/2`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {groups.length > 1 && (
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className={fieldClass}
          >
            <option value="">すべてのグループ</option>
            {groups.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}

        {emptyCount > 0 && (
          <button
            onClick={() => setOnlyWithPhotos((v) => !v)}
            aria-pressed={onlyWithPhotos}
            className={chipButton(onlyWithPhotos)}
          >
            投稿があるものだけ
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-steam-border" />

        {([
          { value: "grid", label: "サムネイル", icon: LayoutGrid },
          { value: "list", label: "一覧", icon: List },
        ] as const).map((v) => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            aria-label={v.label}
            title={v.label}
            aria-pressed={view === v.value}
            className={`${chipButton(view === v.value)} w-11 px-0 md:w-9`}
          >
            <v.icon size={16} aria-hidden="true" />
          </button>
        ))}

        <span className="text-sm text-steam-muted">
          {filtered.length === albums.length
            ? `${albums.length}件`
            : `${filtered.length} / ${albums.length}件`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-steam-muted">該当するアルバムがありません。</p>
      ) : (
        <div className="mt-4">
          {view === "grid" ? <AlbumGrid albums={filtered} /> : <AlbumRows albums={filtered} />}
        </div>
      )}
    </div>
  );
}
