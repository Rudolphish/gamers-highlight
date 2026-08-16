import { Skeleton, CardGridSkeleton } from "@/components/ui/Skeleton";

// グループ詳細：戻るリンク→グループ名→アルバム→みんなのゲーム→ゲーム提案
export default function Loading() {
  return (
    <main className="p-4 sm:p-6">
      <Skeleton className="h-4 w-32" />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <Skeleton className="h-9 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>

      <div className="mt-6">
        <Skeleton className="h-4 w-24" />
        <div className="mt-3">
          <CardGridSkeleton count={4} />
        </div>
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20" />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Skeleton className="h-4 w-28" />
      </div>
    </main>
  );
}
