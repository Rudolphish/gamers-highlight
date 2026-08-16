import { HeaderSkeleton, CardGridSkeleton } from "@/components/ui/Skeleton";

/**
 * (main)配下すべての既定の読み込み表示。
 *
 * **これが無いと、リンクを押してからサーバー描画が終わるまで前のページのまま止まる。**
 * 押した手応えが無いので、実際の待ち時間以上に遅く感じる。
 * loading.tsxを置くと、押した瞬間に骨格が出て、中身が届き次第差し替わる。
 *
 * 個別のページに専用のものがあればそちらが優先される。
 */
export default function Loading() {
  return (
    <main className="p-4 sm:p-6">
      <HeaderSkeleton />
      <div className="mt-6">
        <CardGridSkeleton count={8} />
      </div>
    </main>
  );
}
