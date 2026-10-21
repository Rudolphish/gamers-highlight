// ゲームの状態と提案へのリアクションの「画面での呼び方」。DBの値（WISHLIST・MAYBE など）は変えずに、表示の名前だけをここで決める。
//
// **呼び方はここにしか書かない。** 2026-10 のデザイン刷新（段階3）で「気になる」を「プレイ予定」などに分けたとき、
// 同じ表がゲーム一覧・検索・ゲーム詳細の3か所に書き写してあり、活動の記録に至っては表を持たずに
// DBの値（「WISHLIST → PLAYING」「LIKE」）をそのまま画面に出していた。
export const GAME_STATUS_LABELS = {
  WISHLIST: "プレイ予定",
  PLAYING: "プレイ中",
  BACKLOG: "積みゲー",
  COMPLETED: "クリア済み",
} as const;
export type GameStatusValue = keyof typeof GAME_STATUS_LABELS;

export const PROPOSAL_REACTION_LABELS = {
  LIKE: "やりたい",
  MAYBE: "様子見",
  PASS: "パス",
} as const;
export type ProposalReactionValue = keyof typeof PROPOSAL_REACTION_LABELS;

/** 知らない値（後から種類を足した・壊れた記録）はそのまま返す。表示のために例外は投げない */
export function gameStatusLabel(value: string): string {
  return GAME_STATUS_LABELS[value as GameStatusValue] ?? value;
}
export function proposalReactionLabel(value: string): string {
  return PROPOSAL_REACTION_LABELS[value as ProposalReactionValue] ?? value;
}
