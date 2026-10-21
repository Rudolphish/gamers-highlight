// 使用量／上限のバー。上限に近づくほど色を強める。
export function UsageBar({
  label,
  used,
  limit,
  usedLabel,
  limitLabel,
  note,
}: {
  label: string;
  used: number;
  limit: number;
  usedLabel: string;
  limitLabel: string;
  note?: string;
}) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color =
    percent >= 90
      ? "from-danger/70 to-danger"
      : percent >= 70
        ? "from-warning/70 to-warning"
        : "from-steam-blue/60 to-steam-blue";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xs text-steam-muted">{label}</span>
        <span className="text-3xs text-steam-text">
          <span className="font-bold">{usedLabel}</span>
          <span className="text-steam-muted"> / {limitLabel}</span>
          <span className="ml-1.5 text-steam-muted">({percent.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-steam-panel">
        <div className={`h-full rounded-sm bg-gradient-to-r ${color}`} style={{ width: `${percent}%` }} />
      </div>
      {note && <p className="mt-1 text-4xs text-steam-muted">{note}</p>}
    </div>
  );
}
