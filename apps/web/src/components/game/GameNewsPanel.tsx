import { Newspaper } from "lucide-react";
import { newsContentToParagraphs } from "@/lib/gameDetail";
import type { SteamNewsItem } from "@/lib/steam";

// 最新ニュース1件を全文表示し、残りはタイトルのリンクだけ並べる。
// ゲーム詳細ページと提案の詳細ページで共通。
export function GameNewsPanel({ news }: { news: SteamNewsItem[] }) {
  const [latest, ...others] = news;
  if (!latest) return null;

  const paragraphs = newsContentToParagraphs(latest.contents);

  return (
    <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
        <Newspaper size={12} /> 最新ニュース
      </h2>
      <a
        href={latest.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block font-display text-base font-semibold text-steam-text hover:text-steam-blue"
      >
        {latest.title}
      </a>
      <p className="mt-0.5 font-mono text-4xs text-steam-muted/70">
        {new Date(latest.date * 1000).toLocaleDateString("ja-JP")}
      </p>
      <div className="mt-2 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed text-steam-muted">
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => (
            <p key={i} className="mt-2 first:mt-0">
              {p}
            </p>
          ))
        ) : (
          <p>本文はSteamストアページでご確認ください。</p>
        )}
      </div>

      {others.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-steam-border pt-3">
          {others.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-mono text-3xs text-steam-muted hover:text-steam-blue"
            >
              {item.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
