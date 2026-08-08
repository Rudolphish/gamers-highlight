import { Clock, ExternalLink } from "lucide-react";

type Props = {
  gameId: number;
  main: number;
  mainExtra: number;
  completionist: number;
  allStyles: number;
};

const ROWS: { label: string; key: keyof Omit<Props, "gameId"> }[] = [
  { label: "クリアのみ", key: "main" },
  { label: "やり込み要素込み", key: "mainExtra" },
  { label: "完全収集", key: "completionist" },
  { label: "全プレイスタイル平均", key: "allStyles" },
];

// HowLongToBeatのクリア時間目安をバー表示する（ITADの表示スタイルを参考にした）。
// 非公式スクレイピングの値のため、参考程度の目安として扱う。
export function HltbCard({ gameId, main, mainExtra, completionist, allStyles }: Props) {
  const values = { main, mainExtra, completionist, allStyles };
  const max = Math.max(main, mainExtra, completionist, allStyles, 1);

  return (
    <div className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-steam-muted">
          <Clock size={12} /> HowLongToBeat
        </h2>
        <a
          href={`https://howlongtobeat.com/game/${gameId}`}
          target="_blank"
          rel="noreferrer"
          className="text-steam-muted transition hover:text-steam-blue"
          aria-label="HowLongToBeatで見る"
        >
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {ROWS.map(({ label, key }) => {
          const value = values[key];
          const widthPercent = Math.max((value / max) * 100, 4);
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[9px] text-steam-muted">{label}</span>
                <span className="font-mono text-[10px] font-bold text-steam-text">{value}h</span>
              </div>
              <div className="mt-0.5 h-2 w-full overflow-hidden rounded-sm bg-steam-panel">
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-steam-blue/60 to-steam-blue"
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 font-mono text-[9px] text-steam-muted/60">非公式データのため目安値です</p>
    </div>
  );
}
