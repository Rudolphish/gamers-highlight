import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-steam-bg">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col overflow-y-auto">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
