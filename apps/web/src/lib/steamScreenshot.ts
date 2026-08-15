/**
 * Steamのスクリーンショットのファイル名から、どのゲームのものかを読み取る。
 *
 * Steamは `<appId>_<YYYYMMDDHHMMSS>_<連番>.jpg` という名前で保存するため、
 * ファイル名だけでゲームを特定できる。画像の中身を解析するより桁違いに安く、
 * 手でタグを付ける手間をほぼ無くせる。
 *
 * **14桁の日時部分が一致することを必須にしている。** `123_1.jpg` のような
 * ありふれた名前をapp IDと誤認すると、無関係のゲーム名が勝手に付いてしまうため。
 * 判別できない場合は素直に null を返し、従来どおり手入力に任せる。
 *
 * GeForce ExperienceやWindowsのGame Barで撮ったものは命名規則が違うので当たらない。
 */

/** app IDの下限。Steamの最小appIdは10（Counter-Strike） */
const MIN_APP_ID = 10;

export type SteamScreenshotInfo = {
  appId: number;
  /** 撮影日時（ファイル名の14桁から復元）。取れなければnull */
  capturedAt: Date | null;
};

const PATTERN = /^(\d{2,8})_(\d{14})(?:_(\d+))?\.(?:jpe?g|png)$/i;

/**
 * 14桁（YYYYMMDDHHMMSS）を日時にする。
 * 実在しない日付（13月など）はnullを返し、そのファイルは判別対象から外す。
 */
function parseTimestamp(raw: string): Date | null {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));

  // Steamが存在する前の年や未来の日付は、たまたま桁が合っただけとみなす
  if (year < 2003 || year > new Date().getFullYear() + 1) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second);
  // 2月30日のような繰り上がりを弾く
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date;
}

/** ファイル名がSteamのスクショ形式なら app ID と撮影日時を返す。違えば null */
export function parseSteamScreenshotName(fileName: string): SteamScreenshotInfo | null {
  // パス付きで渡ってきても末尾だけ見る
  const base = fileName.split(/[\\/]/).pop() ?? fileName;

  const match = PATTERN.exec(base);
  if (!match) return null;

  const appId = Number(match[1]);
  if (!Number.isInteger(appId) || appId < MIN_APP_ID) return null;

  const capturedAt = parseTimestamp(match[2]);
  if (!capturedAt) return null;

  return { appId, capturedAt };
}
