// Botが使うメディアの上限値。
//
// **値の正本は `apps/web/src/lib/media-limits.ts`。** Botは
// tsconfig の rootDir が src なのでWeb側を直接importできず、ここに写しを置いている。
// 食い違うと「Botは弾かないのにingestが弾く（＝Discordに投げても黙って無視される）」
// という分かりにくい壊れ方をするので、`tools/local-test/audit-media-limits.mjs` が
// 両方を突き合わせてCIで落とす。値を変えるときは必ずWeb側と一緒に変えること。
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// 長さの上限はBot側では判定しない：Discordの動画添付に長さの情報が無いため
// （Attachment#duration はボイスメッセージ専用）。
