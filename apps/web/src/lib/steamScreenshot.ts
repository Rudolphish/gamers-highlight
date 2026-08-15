/**
 * Steamのスクリーンショットのファイル名から、どのゲームのものかを読み取る。
 *
 * **保存元で名前の形が違う**（実測）:
 *   | 経路                   | 例                        | app ID | 撮影日時 |
 *   | Steamからダウンロード  | `2507950_205.jpg`         | あり   | なし     |
 *   | PCのSteamフォルダ内    | `20260528235035_1.jpg`    | なし   | あり     |
 *   | クリップボードから貼付 | `2026052.jpg`             | なし   | なし     |
 *
 * **フォルダ内のファイル名にapp IDは入っていない。** app IDが入っているのは
 * `userdata/<id>/760/remote/<appId>/screenshots/` という**フォルダ側**で、
 * ブラウザのファイル選択ではフォルダ名を取れないため、ここからゲームは判別できない。
 * それでも日時は「遊んだ時刻」として意味があるので拾う。
 *
 * app IDが取れる形（`<appId>_<連番>`）は、`123_456.jpg` のようなありふれた名前と
 * 字面で区別できない。そこで確信度を返し、低い方は**実在するゲームだと確認できたときだけ**
 * 採用する（呼び出し側でゲーム名が解決できたかを見る）。ここで甘くすると、
 * 無関係の画像に別のゲーム名が勝手に付く。
 */

/** app IDの下限。Steamの最小appIdは10（Counter-Strike） */
const MIN_APP_ID = 10;

/**
 * app IDの上限。現行のapp IDは400万程度なので、1000万あれば当面足りる。
 * 上限を設けているのは `20260814_170000.jpg`（日付_時刻）のような名前を
 * app IDと誤認しないため。
 */
const MAX_APP_ID = 10_000_000;

export type ScreenshotConfidence = "high" | "low";

export type SteamScreenshotInfo = {
  /** ファイル名から取れたapp ID。取れない形式ではnull */
  appId: number | null;
  /** 撮影日時。ファイル名に日時を含む形式のときだけ入る */
  capturedAt: Date | null;
  /**
   * app IDの確からしさ。appIdがnullのときはnull。
   * high: 日時も伴う＝Steamのスクショとほぼ断定できる
   * low : 連番のみ＝偶然一致した可能性があるので、実在するゲームか確認してから使う
   */
  confidence: ScreenshotConfidence | null;
};

/** app IDと日時の両方を含む形式（Steamの版や設定によってはこの形になる） */
const WITH_TIMESTAMP = /^(\d{2,8})_(\d{14})(?:_(\d+))?\.(?:jpe?g|png)$/i;

/** Steamからダウンロードした形式。連番が長すぎるものは別物とみなす */
const WITH_INDEX = /^(\d{2,8})_(\d{1,6})\.(?:jpe?g|png)$/i;

/** PCのSteamフォルダ内の形式。日時だけでゲームは分からない */
const TIMESTAMP_ONLY = /^(\d{14})(?:_(\d+))?\.(?:jpe?g|png)$/i;

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

function validAppId(raw: string): number | null {
  const appId = Number(raw);
  if (!Number.isInteger(appId)) return null;
  if (appId < MIN_APP_ID || appId > MAX_APP_ID) return null;
  return appId;
}

/** ファイル名がSteamのスクショ形式なら app ID などを返す。違えば null */
export function parseSteamScreenshotName(fileName: string): SteamScreenshotInfo | null {
  // パス付きで渡ってきても末尾だけ見る
  const base = fileName.split(/[\\/]/).pop() ?? fileName;

  const timestamped = WITH_TIMESTAMP.exec(base);
  if (timestamped) {
    const appId = validAppId(timestamped[1]);
    const capturedAt = parseTimestamp(timestamped[2]);
    // 日時の形はしているが中身がありえない場合は、Steamのスクショではないと判断する
    if (appId !== null && capturedAt) {
      return { appId, capturedAt, confidence: "high" };
    }
    return null;
  }

  const indexed = WITH_INDEX.exec(base);
  if (indexed) {
    const appId = validAppId(indexed[1]);
    if (appId !== null) {
      return { appId, capturedAt: null, confidence: "low" };
    }
  }

  // 日時だけの形。ゲームは分からないが、撮影時刻は使える
  const timeOnly = TIMESTAMP_ONLY.exec(base);
  if (timeOnly) {
    const capturedAt = parseTimestamp(timeOnly[1]);
    if (capturedAt) {
      return { appId: null, capturedAt, confidence: null };
    }
  }

  return null;
}
