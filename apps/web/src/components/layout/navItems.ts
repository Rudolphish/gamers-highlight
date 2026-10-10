import {
  FileText,
  Film,
  Home,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

// ナビゲーションの項目。**PCのサイドバーとモバイルのドロワーの両方がここを読む。**
// 2箇所に書くと、画面幅によって行ける場所が変わる（特に管理者リンクの出し分けがずれる）。
export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "ナビゲーション",
    items: [
      { href: "/", label: "ホーム", icon: Home },
      { href: "/groups", label: "グループ", icon: Users },
      { href: "/albums", label: "アルバム", icon: Film },
      { href: "/upload", label: "アップロード", icon: Upload },
      { href: "/manual", label: "マニュアル", icon: FileText },
    ],
  },
  {
    label: "管理",
    items: [
      { href: "/search", label: "検索", icon: Search },
      { href: "/settings/discord", label: "設定", icon: Settings },
    ],
  },
];

// 管理者だけに出すリンク（実際の権限判定はページ側でサーバー側に行わせる）
const ADMIN_GROUP: NavGroup = {
  label: "管理者",
  items: [{ href: "/admin", label: "使用量・メディア", icon: ShieldCheck }],
};

export function getNavGroups(isAdmin: boolean | undefined): NavGroup[] {
  return isAdmin ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS;
}

// 現在地の判定。`/` を前方一致にすると全ページで光るので完全一致だけにする
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}
