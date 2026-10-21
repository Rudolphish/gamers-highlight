import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * 「まだ何も無い」ときの見せ方（デザイン刷新の段階6）。アイコン・見出し・説明・次にできる操作。
 * 以前は画面ごとに1行の灰色の文だけで、何をすれば埋まるのかが目立たなかった。
 * 検索の候補が0件のような、部品の中の小さな「見つかりませんでした」は1行のままでよい
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div data-testid="empty-state" className="flex flex-col items-center gap-3 rounded-xl bg-steam-surface px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-steam-panel text-steam-blue">
        <Icon size={22} aria-hidden="true" />
      </span>
      <div>
        <p className="text-base font-bold text-steam-text">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-sm text-steam-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
