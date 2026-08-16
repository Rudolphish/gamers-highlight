import { Skeleton } from "@/components/ui/Skeleton";

// アルバム詳細：見出し＋写真グリッド（カードより小さい正方形が並ぶ）
export default function Loading() {
  return (
    <main className="p-4 sm:p-6">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    </main>
  );
}
