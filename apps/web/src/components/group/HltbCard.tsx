import { Clock, ExternalLink } from "lucide-react";

type Props = {
  /** HowLongToBeat 側のID。見つからなかった・取れなかったときは null */
  gameId: number | null;
  /** 未収録の項目はnull。行ごと表示しない */
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
  allStyles: number | null;
};

const ROWS: { label: string; key: keyof Omit<Props, "gameId"> }[] = [
  { label: "クリアのみ", key: "main" },
  { label: "やり込み要素込み", key: "mainExtra" },
  { label: "完全収集", key: "completionist" },
  { label: "全プレイスタイル平均", key: "allStyles" },
];

// HowLongToBeatのクリア時間目安をバー表示する（ITADの表示スタイルを参考にした）。
// 非公式スクレイピングの値のため、参考程度の目安として扱う。
//
// **取れなかったときも枠だけは出して「データなし」と書く**（ユーザー判断）。以前は丸ごと出さなかったので、
// 「このゲームには無い」のか「表示し忘れ」なのかが画面から分からなかった。
// HowLongToBeat は先方の仕様変更で落ちる前提で、収録されていないゲームも普通にある（CLAUDE.md）
export function HltbCard({ gameId, main, mainExtra, completionist, allStyles }: Props) {
  const values = { main, mainExtra, completionist, allStyles };
  const hasAny = gameId !== null && Object.values(values).some((v) => v !== null);
  // 項目ごとに収録状況が違う（完全収集だけ未収録、等）ため、
  // 揃っている項目だけでバーの基準を決める
  const max = Math.max(...Object.values(values).filter((v): v is number => v !== null), 1);

  return (
    <div className="rounded-xl bg-steam-surface p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-wide text-steam-muted">
          <Clock size={12} /> HowLongToBeat
        </h2>
        {hasAny && (
          <a
            href={`https://howlongtobeat.com/game/${gameId}`}
            target="_blank"
            rel="noreferrer"
            className="text-steam-muted transition hover:text-steam-blue"
            aria-label="HowLongToBeatで見る"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {!hasAny ? (
        <p data-testid="hltb-empty" className="mt-3 text-sm text-steam-muted">
          HowLongToBeat のデータなし
        </p>
      ) : (
      <>
      <div className="mt-3 flex flex-col gap-2">
        {ROWS.map(({ label, key }) => {
          const value = values[key];
          if (value === null) return null;
          const widthPercent = Math.max((value / max) * 100, 4);
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="text-4xs text-steam-muted">{label}</span>
                <span className="text-3xs font-bold text-steam-text">{value}h</span>
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

      <p className="mt-2 text-4xs text-steam-muted">非公式データのため目安値です</p>
      </>
      )}
    </div>
  );
}
