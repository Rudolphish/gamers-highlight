// 重ねて出す箱（モーダル）の枠とパネル。8つのモーダルがこれを使う（Lightbox は写真を全面に出すので別）。
//
// **パネルが画面より高くなっても、上から下まで届くようにする。** 以前は枠を `flex items-center justify-center` で
// 真ん中に寄せ、パネルには高さの上限もスクロールも無かった。グループの「メンバー」はオーナーだと
// メンバー一覧・招待・招待リンクで 1054px あり、iPhone（844px）でも上下がはみ出したまま動かせず、
// **上の「閉じる」にも届かなかった**（ホーム画面に置いた Safari で「メンバー一覧がスクロールしない」と報告された）。
//
// - 枠そのものを `overflow-y-auto` にして、はみ出したら枠ごとスクロールさせる
// - 真ん中に寄せるのは枠の `justify-center` ではなくパネルの `m-auto`。`justify-center` ははみ出すと
//   **上側も画面の外へ押し出し、スクロールでも戻れない**。`m-auto` は収まるときだけ真ん中に来て、
//   はみ出すときは上から並ぶ
// - `overscroll-contain` で、枠の端まで送ったときに後ろのページまで動かさない
// - iPhone の上下の安全領域（`viewport-fit=cover` なので、ホーム画面のアプリでは上の時計・下のホームバーの下まで広がる）を避ける
//
// browser.mjs の B153 が、縦の短い画面で全部のモーダルの一番上と一番下の部品まで届くかを見ている。
// 文字列の定数にしてあるのは、Tailwind がソースの文字列からクラスを拾うため（buttonStyles.ts と同じ）。
export const modalOverlay =
  "fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-black/70 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]";

/** パネル。幅はスマホでは画面いっぱい、PC では 28rem まで */
export const modalPanel = "m-auto w-full max-w-md rounded-xl bg-steam-surface p-4";
