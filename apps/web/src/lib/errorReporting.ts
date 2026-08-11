import { createHash } from "crypto";
import { db } from "./db";
import { postDiscordMessage } from "./discord";
import { APP_SETTING_KEYS, getAppSetting } from "./appSettings";

/**
 * 同じ不具合を再通知するまでの間隔。
 * 壊れたページを何度も開かれた時にチャンネルが埋まると、かえって気づけなくなる。
 */
const RENOTIFY_INTERVAL_MS = 30 * 60 * 1000;

/** Discordのメッセージ上限は2000文字。本文の一部として使うので余裕を持って切る */
const MAX_MESSAGE_LENGTH = 500;
const MAX_PATH_LENGTH = 200;

export type ErrorReportInput = {
  /** 本番のサーバー側エラーはメッセージが伏せられ、これだけが手掛かりになる */
  digest?: string | null;
  message: string;
  path: string;
};

/**
 * 同じ不具合をまとめるためのキー。
 * digestがあればNext.jsが同じ原因に同じ値を割り当てるのでそのまま使う。
 * 無い場合（クライアント側の例外）はメッセージとパスから作る。
 */
function fingerprintOf(input: ErrorReportInput): string {
  if (input.digest) return `digest:${input.digest}`;
  return `msg:${createHash("sha256").update(`${input.message}|${input.path}`).digest("hex").slice(0, 32)}`;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * エラーを記録し、必要ならDiscordへ通知する。
 *
 * 記録も通知も本来の処理の付帯物なので、ここで例外を投げない。
 * 通知先が未設定なら記録だけ行う（後から設定した時点で /admin/errors に履歴が残っている）。
 */
export async function recordError(input: ErrorReportInput): Promise<void> {
  try {
    const fingerprint = fingerprintOf(input);
    const message = truncate(input.message || "(メッセージなし)", MAX_MESSAGE_LENGTH);
    const path = truncate(input.path || "(不明)", MAX_PATH_LENGTH);

    const existing = await db.errorReport.findUnique({ where: { fingerprint } });

    const report = existing
      ? await db.errorReport.update({
          where: { fingerprint },
          data: { count: { increment: 1 }, lastSeenAt: new Date(), message, path },
        })
      : await db.errorReport.create({ data: { fingerprint, message, path } });

    const shouldNotify =
      report.notifiedAt === null ||
      Date.now() - report.notifiedAt.getTime() >= RENOTIFY_INTERVAL_MS;
    if (!shouldNotify) return;

    const channelId = await getAppSetting(APP_SETTING_KEYS.errorNotifyChannelId);
    if (!channelId) return;

    const lines = [
      "⚠️ **ShareStaqでエラーが発生しました**",
      `**場所**: \`${path}\``,
      `**内容**: \`${message}\``,
      input.digest ? `**digest**: \`${input.digest}\`（Vercelのログ検索に使えます）` : null,
      report.count > 1 ? `**累計**: ${report.count}回目` : null,
    ].filter(Boolean);

    const posted = await postDiscordMessage(channelId, lines.join("\n"));
    if (posted) {
      await db.errorReport.update({
        where: { fingerprint },
        data: { notifiedAt: new Date() },
      });
    }
  } catch (e) {
    // 監視の失敗でアプリを壊さない
    console.error("[errorReporting] failed to record", e);
  }
}
