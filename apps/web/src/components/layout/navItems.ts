import {
  BookOpen,
  Film,
  Home,
  Link2,
  ListChecks,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

// ナビゲーションの項目。**PCの左メニュー（Sidebar）・スマホの下のタブ（BottomTabs）・「自分」ページの3つがここを読む。**
// 別々に書くと、画面幅によって行ける場所が変わる（特に管理者リンクの出し分けがずれる）。
// スマホのタブは5つしか置けないので、PCのメニューにあってタブに無い行き先は「自分」ページに必ず並べる。
// 「PCで行ける場所はスマホでも全部行ける」は browser.mjs の B128 が実際の画面で突き合わせている。
export type NavItem = { href: string; label: string; icon: LucideIcon };

// PCの左メニュー。見本（2026-10 のデザイン刷新）どおり、よく使う5つ・区切り・使い方と設定
const SIDEBAR_MAIN: NavItem[] = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/groups", label: "グループ", icon: Users },
  { href: "/albums", label: "アルバム", icon: Film },
  { href: "/upload", label: "写真を投稿", icon: Upload },
  { href: "/search", label: "検索", icon: Search },
];
const SIDEBAR_SUB: NavItem[] = [
  { href: "/manual", label: "使い方", icon: BookOpen },
  { href: "/settings/profile", label: "設定", icon: Settings },
];
// 管理者だけに出すリンク（実際の権限判定はページ側でサーバー側に行わせる）
const ADMIN_ITEM: NavItem = { href: "/admin", label: "管理", icon: ShieldCheck };

export function getSidebarSections(isAdmin: boolean | undefined): NavItem[][] {
  return [SIDEBAR_MAIN, isAdmin ? [...SIDEBAR_SUB, ADMIN_ITEM] : SIDEBAR_SUB];
}

// スマホの下のタブ。真ん中の「投稿」だけ丸い青のボタンにする（いちばん使う操作なので）
export type TabItem = NavItem & { primary?: boolean; matches: (pathname: string) => boolean };
export const ME_HREF = "/me";
export const TAB_ITEMS: TabItem[] = [
  { href: "/", label: "ホーム", icon: Home, matches: (p) => p === "/" },
  { href: "/groups", label: "グループ", icon: Users, matches: (p) => p.startsWith("/groups") },
  { href: "/upload", label: "投稿", icon: Upload, primary: true, matches: (p) => p.startsWith("/upload") },
  { href: "/albums", label: "アルバム", icon: Film, matches: (p) => p.startsWith("/albums") },
  // 「自分」から開く画面（設定・検索・使い方・管理）にいる間も、このタブを光らせる。
  // どのタブにも印が無いと、今どこにいるのか・どこから戻ればいいのかが分からなくなる
  {
    href: ME_HREF,
    label: "自分",
    icon: UserRound,
    matches: (p) => [ME_HREF, "/settings", "/search", "/manual", "/admin"].some((h) => p === h || p.startsWith(`${h}/`)),
  },
];

// 「自分」ページの一覧。PCのメニューのうちタブに無いもの（検索・使い方・設定・管理）はここで必ず拾う
export type MeSection = { label: string; items: NavItem[] };
export function getMeSections(isAdmin: boolean | undefined): MeSection[] {
  const settings: NavItem[] = [
    { href: "/settings/profile", label: "プロフィール", icon: UserRound },
    { href: "/settings/discord", label: "Discord連携", icon: MessageSquare },
    { href: "/settings/channel-mapping", label: "チャンネル連携", icon: Link2 },
  ];
  if (isAdmin) settings.push({ href: "/settings/allowlist", label: "許可リスト", icon: ListChecks });
  const sections: MeSection[] = [
    { label: "設定", items: settings },
    {
      label: "その他",
      items: [
        { href: "/search", label: "写真を探す", icon: Search },
        { href: "/manual", label: "使い方", icon: BookOpen },
      ],
    },
  ];
  if (isAdmin) sections.push({ label: "管理者", items: [{ ...ADMIN_ITEM, label: "管理（使用量・メディア）" }] });
  return sections;
}

// 現在地の判定。`/` を前方一致にすると全ページで光るので完全一致だけにする。
// 「設定」は /settings/profile を指すが、/settings/discord などにいる間も光らせる
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  const base = href.startsWith("/settings/") ? "/settings" : href;
  return pathname === base || pathname.startsWith(`${base}/`);
}
