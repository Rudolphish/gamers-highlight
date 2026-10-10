import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { RouteProgress } from "@/components/ui/RouteProgress";

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
// `<main>` はページ側が全部（27ページ）持っているので、ここでは出さない。
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] w-full bg-steam-bg">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <Sidebar />
      <div className="flex min-h-[100dvh] flex-1 flex-col overflow-y-auto">
        <Header />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-steam-border px-4 py-3 text-center font-mono text-3xs text-steam-muted/60 sm:px-6">
          © {new Date().getFullYear()} ShareStaq
        </footer>
      </div>
    </div>
  );
}
