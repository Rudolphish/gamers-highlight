/**
 * 遊んだ時間の表記（「2時間30分」「45分」「1分未満」）。DBを読まないので、画面側の部品からも使える。
 *
 * 以前はゲーム詳細（`components/game/GroupPlayLogPanel.tsx`）と通知（`lib/playLogNotify.ts`）に
 * 同じ中身の関数が別々にあった。グループ画面・ゲーム一覧でも使うので1つにした。
 */
export function formatPlayDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "1分未満";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m}分` : m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
