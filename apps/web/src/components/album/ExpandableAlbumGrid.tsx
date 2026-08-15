"use client";

import { useState } from "react";
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
  groupName?: string | null;
};

/**
 * 最初は数件だけ出し、ボタンで少しずつ増やすアルバム一覧。
 *
 * グループ画面はアルバムの下にゲームリストや提案が続くので、アルバムが増えると
 * その下が押し出されて見えなくなる。既定を絞ってスクロール量を抑える。
 *
 * **データは既にサーバーから受け取っている分を出し入れするだけ**で、
 * ボタンを押しても取得は発生しない。友人内で使う規模なら、
 * ページ送りのために毎回問い合わせるより単純で速い。
 */
export function ExpandableAlbumGrid({
  albums,
  initialCount = 5,
  step = 5,
}: {
  albums: Album[];
  initialCount?: number;
  step?: number;
}) {
  const [visible, setVisible] = useState(initialCount);
  const remaining = albums.length - visible;

  return (
    <>
      <AlbumGrid albums={albums.slice(0, visible)} />

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
