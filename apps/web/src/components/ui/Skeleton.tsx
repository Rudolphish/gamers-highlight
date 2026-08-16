/**
 * 読み込み中のプレースホルダ。
 *
 * 実際の描画が速くなるわけではないが、**押した直後に画面が変わる**ことで
 * 待ち時間の体感は大きく変わる。loading.tsx から使い、遷移先の骨格を先に出す。
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-sm bg-steam-panel ${className}`}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-steam-border/40 to-transparent" />
    </div>
  );
}

/** アルバム/ゲームのカード1枚分 */
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-sm border border-steam-border bg-steam-surface">
      <Skeleton className="h-32 w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

/** カードを並べたグリッド */
export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** 見出し（タイトル＋右側のボタン） */
export function HeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-32" />
    </div>
  );
}
