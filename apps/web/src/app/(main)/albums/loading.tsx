import { Skeleton, HeaderSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";

// アルバム一覧：見出し＋絞り込みバー＋カード
export default function Loading() {
  return (
    <main className="p-4 sm:p-6">
      <HeaderSkeleton />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-[200px] flex-1" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
      </div>
      <div className="mt-4">
        <CardGridSkeleton count={8} />
      </div>
    </main>
  );
}
