/**
 * JST（日本時間）の日付を扱う共通処理。
 *
 * ユーザーも投稿も日本時間で動くので、「その日」「その週」の境界はJSTで切る。
 * UTCで切ると、夜9時以降の投稿が翌日（翌週）扱いになる。
 *
 * **`ApiUsage.date` がUTC基準なのとは意味が違う。** あちらはYouTubeのクォータの
 * リセットに合わせている。同じ `@db.Date` でも基準が違うので混同しないこと。
 *
 * オフセットを固定値にしているのは、日本に夏時間が無いため。
 */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * JSTでの日付を `YYYY-MM-DD` で返す。
 *
 * 実装は「JSTの壁時計をUTCとして読む」形。サーバーのタイムゾーンに依存しないので、
 * Vercelでもローカルでも同じ結果になる（`toLocaleDateString` はランタイムの
 * ICUデータに依存するうえ、書式が環境で揺れる）。
 */
export function jstDateString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD`（JST）が指す1日の範囲を、UTCの瞬間として返す */
export function jstDayRange(dateString: string): { start: Date; end: Date } {
  const start = new Date(`${dateString}T00:00:00.000+09:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * `DailyActivity.date`（`@db.Date`）に入れる値。
 *
 * Prismaの `@db.Date` は時刻を切り捨てて日付だけを保存するが、**切り捨ては UTC で行われる**。
 * JSTの日付をそのまま `new Date("2026-08-22T00:00:00+09:00")` で渡すと、
 * UTCでは前日の15時なので **8/21 として保存される**。
 * UTCの0時に置き直してから渡すこと。
 */
export function jstDateColumn(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

/**
 * `DailyActivity.date` から読み出した値を `YYYY-MM-DD` に戻す。
 *
 * **`jstDateString()` を使わないこと。** 保存時にUTCの0時へ置き直しているので、
 * 読み出した値は「JSTの日付をUTCの0時で表したもの」であって実際の瞬間ではない。
 * ここに9時間足すのは意味が無く、境界の扱いを間違えるとその日ごとずれる。
 */
export function dateColumnToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
