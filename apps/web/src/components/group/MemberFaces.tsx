import { accountInitial } from "@/components/layout/accountInitial";
import { MemberFace } from "./MemberFace";

// グループの見出しに並べるメンバーの顔ぶれ。誰のグループかが一目で分かるように出す。
// Discord のアイコンがある人は画像、無い人（・読めない人）は頭文字の丸（2026-10-21 ユーザー判断。以前は全員が頭文字だった）。
// 色は人ごとに固定（IDから選ぶ）。並び順で色を決めると、人が増えるたびに全員の色が入れ替わる。
// 丸の上の文字は濃い色（accent-ink）なので、どの色も明るめにしてある（背景との差 4.5:1 以上）
const COLORS = ["#5ab0ea", "#e7a35a", "#9be08b", "#d58bd0", "#8fb8d8", "#e8d36a"];
const MAX_FACES = 5;

function colorOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function MemberFaces({ members }: { members: { id: string; name: string | null; avatarUrl: string | null }[] }) {
  const shown = members.slice(0, MAX_FACES);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center" aria-label={`メンバー${members.length}人`} role="img">
      {shown.map((m, i) => (
        <MemberFace
          key={m.id}
          name={m.name}
          initial={accountInitial(m.name)}
          avatarUrl={m.avatarUrl}
          color={colorOf(m.id)}
          overlap={i > 0}
        />
      ))}
      {rest > 0 && (
        <span className="-ml-2 flex h-8 min-w-[2rem] items-center justify-center rounded-full border-2 border-steam-bg bg-steam-panel px-1.5 font-num text-xs text-steam-text">
          {`+${rest}`}
        </span>
      )}
    </div>
  );
}
