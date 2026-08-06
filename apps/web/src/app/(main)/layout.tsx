import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { RouteProgress } from "@/components/ui/RouteProgress";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-steam-bg">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col overflow-y-auto">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
