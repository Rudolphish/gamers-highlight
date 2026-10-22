import { useSyncExternalStore } from "react";

// 画面を移っている間の状態。RouteLoading が書き、ロゴのマーク（LiveBrandMark）と重ねる表示が読む。
// - idle  : 何も出さない（移っていない、または0.3秒以内に終わった）
// - short : 0.3秒を超えた。上の進行バー＋ロゴのマークが動く
// - long  : 1秒を超えた。本文の場所に重ねて、中央にマーク＋ロゴを出す
//
// **Suspense（loading.tsx）で作らない。** Next.js 15.5 では loading.tsx の境界の下で router.refresh() すると、
// 数回に1回、画面が切り替わらないまま止まる（CLAUDE.md「loading.tsx を置かない」）。ここはブラウザ側だけで判定する
export type NavLoadingPhase = "idle" | "short" | "long";

let phase: NavLoadingPhase = "idle";
const listeners = new Set<() => void>();

export function setNavLoadingPhase(next: NavLoadingPhase) {
  if (next === phase) return;
  phase = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** サーバーで描くときは必ず idle（最初の描画とブラウザの描画を食い違わせない） */
export function useNavLoadingPhase(): NavLoadingPhase {
  return useSyncExternalStore(
    subscribe,
    () => phase,
    () => "idle"
  );
}
