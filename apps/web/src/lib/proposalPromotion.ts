// ゲーム提案が自動でリストに入る条件（「いいね」の必要数）。
//
// **式を1箇所に集める。** 判定するのは投票のAPI、文面に出すのは提案作成時の通知、
// 説明するのはマニュアルと、同じ数字を3箇所が使う。別々に書くと、片方だけ変えたときに
// 「通知の文面だけ嘘になる」という気づきにくい壊れ方をする
// （実際に通知を足すとき、オーナー分の +1 を落とした式を書きかけた）。
//
// **オーナーは `GroupMember` の行を持たない。** グループ作成時に作られるのは
// `Group.ownerId` だけなので、母数はメンバー数 + 1 になる。
export function promotionThreshold(groupMemberCount: number): number {
  const totalMembers = 1 + groupMemberCount; // オーナー分 +1
  return Math.floor(totalMembers / 2) + 1;
}
