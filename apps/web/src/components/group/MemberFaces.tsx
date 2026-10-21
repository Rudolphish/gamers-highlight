import { accountInitial } from "@/components/layout/accountInitial";

// グループの見出しに並べるメンバーの顔ぶれ（頭文字の丸）。誰のグループかが一目で分かるように出す。
// 色は人ごとに固定（IDから選ぶ）。並び順で色を決めると、人が増えるたびに全員の色が入れ替わる。
// 丸の上の文字は濃い色（accent-ink）なので、どの色も明るめにしてある（背景との差 4.5:1 以上）
const COLORS = ["#5ab0ea", "#e7a35a", "#9be08b", "#d58bd0", "#8fb8d8", "#e8d36a"];
const MAX_FACES = 5;

function colorOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function MemberFaces({ members }: { members: { id: string; name: string | null }[] }) {
  const shown = members.slice(0, MAX_FACES);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center" aria-label={`メンバー${members.length}人`} role="img">
      {shown.map((m, i) => (
        <span
          key={m.id}
          title={m.name ?? undefined}
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-steam-bg text-xs font-bold text-accent-ink ${i > 0 ? "-ml-2" : ""}`}
          style={{ background: colorOf(m.id) }}
        >
          {accountInitial(m.name)}
        </span>
      ))}
      {rest > 0 && (
        <span className="-ml-2 flex h-8 min-w-[2rem] items-center justify-center rounded-full border-2 border-steam-bg bg-steam-panel px-1.5 font-num text-xs text-steam-text">
          {`+${rest}`}
        </span>
      )}
    </div>
  );
}
