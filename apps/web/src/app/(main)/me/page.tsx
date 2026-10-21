import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/currentUser";
import { isAdminEmail } from "@/lib/admin";
import { getMeSections } from "@/components/layout/navItems";
import { accountInitial } from "@/components/layout/accountInitial";
import { SignOutButton } from "@/components/me/SignOutButton";

export const dynamic = "force-dynamic";

// 「自分」ページ（2026-10 のデザイン刷新で新設）。スマホの下のタブの「自分」と、PCの左下のアカウントから来る。
// スマホのタブは5つしか無いので、PCの左メニューにあってタブに無い行き先（検索・使い方・設定・管理）を全部ここに並べる。
// 一覧の中身は components/layout/navItems.ts の getMeSections が正本。
//
// 管理者の項目の出し分けは表示だけ。管理画面と許可リストは、それぞれのページとAPIがサーバー側で判定している
export default async function MePage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  const user = await db.user.findUnique({ where: { id: current.id }, select: { name: true, email: true } });
  const name = user?.name ?? user?.email ?? "";
  const sections = getMeSections(isAdminEmail(user?.email ?? current.email));

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-6">
      <h1 className="sr-only">自分</h1>
      <div className="flex items-center gap-4 rounded-xl bg-steam-surface p-4">
        <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-steam-blue text-xl font-bold text-accent-ink">
          {accountInitial(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-steam-text">{name}</p>
          {user?.email && user.email !== name && <p className="truncate text-sm text-steam-muted">{user.email}</p>}
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.label} className="mt-6">
          <h2 className="mb-2 px-1 text-sm font-bold text-steam-muted">{section.label}</h2>
          <ul className="overflow-hidden rounded-xl bg-steam-surface">
            {section.items.map((item, i) => (
              <li key={item.href} className={i > 0 ? "border-t border-steam-border" : ""}>
                <Link href={item.href} className="flex h-12 items-center gap-3 px-4 text-sm text-steam-text transition hover:bg-steam-panel">
                  <item.icon size={18} className="flex-shrink-0 text-steam-muted" aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight size={16} className="text-steam-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="mt-6">
        <SignOutButton />
      </div>
    </main>
  );
}
