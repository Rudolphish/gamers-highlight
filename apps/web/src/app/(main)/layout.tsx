import { Suspense } from "react";
import Link from "next/link";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomTabs } from "@/components/layout/BottomTabs";
import { RouteProgress } from "@/components/ui/RouteProgress";

// 骨組み（2026-10 のデザイン刷新）: PC（768px以上）は左の名前付きメニュー、スマホは下のタブ。上のヘッダーは無い。
// スマホだけ、上にロゴの帯を出す（sticky にしない。縦が狭いので、スクロールしたら流れていってよい）。
//
// 高さは `100dvh`。`100vh` は iOS Safari でブラウザUIの下まで数えるので、短いページで
// フッターが画面の外に出る。
//
// **内側の div の `overflow-y-auto` は外さない。** 縦のスクローラに見えるが、高さが
// 固定されていないので中身に合わせて伸びるだけで、縦に使われたことは一度も無い
// （実測: `clientHeight === scrollHeight === 1355`。スクロールしているのは body の側）。
// 一方 `overflow-x` が `auto` に計算されるため、**幅の広い中身がページ全体を横に流すのを
// 抑えているのはここ**。外すとホームで 390px の画面に 860px 分の横スクロールが出る
// （`tools/local-test/browser.mjs` の B91 で確認済み）。
//
// スマホでは下のタブ（高さ56px＋ホームバーの余白）が本文の上に固定で重なるので、
// 同じぶんだけ下を空ける。空けないと、ページのいちばん下のボタンやフッターがタブの裏に隠れて押せない（B88）。
// 左右の `safe-area-inset` は、`viewport-fit=cover` にしたことで横向きの iPhone でノッチの下に本文が潜らないようにするため。
//
// `<main>` はページ側が全部（27ページ）持っているので、ここでは出さない。
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] w-full bg-steam-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <Sidebar />
      <div className="flex min-h-[100dvh] flex-1 flex-col overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="flex items-center px-4 pb-1 pt-3 md:hidden">
          <Link href="/" aria-label="ShareStaq ホーム" className="font-logo text-xl font-bold tracking-tight text-steam-text">
            Share<span className="text-steam-blue">Staq</span>
          </Link>
        </div>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-steam-border px-4 py-3 text-center text-3xs text-steam-muted sm:px-6">
          © {new Date().getFullYear()} ShareStaq
        </footer>
      </div>
      <BottomTabs />
    </div>
  );
}
