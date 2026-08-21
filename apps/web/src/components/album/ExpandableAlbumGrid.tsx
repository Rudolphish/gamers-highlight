"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AlbumGrid } from "./AlbumGrid";

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
  createdAt: Date | string;
  groupName?: string | null;
};

export type AlbumSort = "updated" | "created" | "title" | "photos";

const SORT_LABEL: Record<AlbumSort, string> = {
  updated: "更新順",
  created: "新着順",
  title: "名前順",
  photos: "写真の多い順",
};

const SORT_ORDER: AlbumSort[] = ["updated", "created", "title", "photos"];

/** 画面を開いた直後の並び。最後に動きがあったアルバムが上に来る */
const DEFAULT_SORT: AlbumSort = "updated";

/**
 * **`unstable_cache` を通ると `Date` はISO文字列で返る**（`CLAUDE.md` の
 * 「`unstable_cache` は Date を文字列にして返す」）。1回目の描画は素の `Date`、
 * キャッシュヒットの回は文字列になるので、**どちらでも同じ値になる読み方をする**。
 * ここを `.getTime()` の直呼びにすると、2回目に開いたときだけ並びが壊れる。
 */
function time(value: Date | string) {
  return new Date(value).getTime();
}

function compare(a: Album, b: Album, sort: AlbumSort) {
  switch (sort) {
    case "created":
      return time(b.createdAt) - time(a.createdAt);
    // 日本語のタイトルが混ざるので localeCompare に "ja" を渡す。
    // 素の比較だとコードポイント順になり、ひらがな/カタカナ/漢字がばらばらに並ぶ
    case "title":
      return a.title.localeCompare(b.title, "ja");
    case "photos":
      return b.photoCount - a.photoCount;
    default:
      return time(b.updatedAt) - time(a.updatedAt);
  }
}

/**
 * 最初は数件だけ出し、ボタンで少しずつ増やすアルバム一覧。並び替えもここで行う。
 *
 * グループ画面はアルバムの下にゲームリストや提案が続くので、アルバムが増えると
 * その下が押し出されて見えなくなる。既定を絞ってスクロール量を抑える。
 *
 * **データは既にサーバーから受け取っている分を出し入れするだけ**で、
 * ボタンを押しても取得は発生しない。並び替えも同じくクライアント側で完結する
 * （友人内で使う規模なら、並び順ごとに問い合わせ直すより単純で速い）。
 *
 * ただし**サーバーが渡してくるのは「更新が新しい順の上位N件」**なので、
 * 並び替えの対象はその範囲内。N件に収まらないグループでは、たとえば名前順にしても
 * 「更新が古くて読み込まれていないアルバム」は出てこない。呼び出し側がその旨を
 * 表示している（`ALBUM_PAGE_SIZE` を超えた場合のみ）。
 */
export function ExpandableAlbumGrid({
  albums,
  initialCount = 4,
  step = 4,
}: {
  albums: Album[];
  initialCount?: number;
  step?: number;
}) {
  const [visible, setVisible] = useState(initialCount);
  const [sort, setSort] = useState<AlbumSort>(DEFAULT_SORT);

  const sorted = useMemo(() => {
    // 元の配列を破壊しない（propsをsortすると再描画のたびに入力が変わる）
    return [...albums].sort(
      // 同点のときは更新順に倒して、並びが実行ごとに揺れないようにする
      (a, b) => compare(a, b, sort) || time(b.updatedAt) - time(a.updatedAt)
    );
  }, [albums, sort]);

  const remaining = sorted.length - visible;

  return (
    <>
      {albums.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-3xs text-steam-muted/70">並び替え</span>
          {SORT_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={`rounded-sm border px-2 py-1 font-mono text-3xs transition ${
                sort === s
                  ? "border-steam-blue text-steam-blue"
                  : "border-steam-border text-steam-muted hover:border-steam-blue"
              }`}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <AlbumGrid albums={sorted.slice(0, visible)} />

      {remaining > 0 && (
        <button
          onClick={() => setVisible((n) => n + step)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-steam-border bg-steam-surface py-2 font-mono text-3xs text-steam-muted transition hover:border-steam-blue hover:text-steam-blue"
        >
          <ChevronDown size={12} />
          さらに表示（残り{remaining}件）
        </button>
      )}
    </>
  );
}
