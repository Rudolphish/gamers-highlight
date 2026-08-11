import { db } from "./db";

/**
 * アプリ全体の設定（AppSetting）のキー。
 * 環境変数にしないのは、変更のたびに再デプロイが必要になるため。
 */
export const APP_SETTING_KEYS = {
  /** エラー通知の投稿先DiscordチャンネルID。未設定なら通知しない */
  errorNotifyChannelId: "errorNotifyChannelId",
} as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];

export async function getAppSetting(key: AppSettingKey): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** 空文字を渡すと設定を消す（＝未設定に戻す） */
export async function setAppSetting(key: AppSettingKey, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await db.appSetting.deleteMany({ where: { key } });
    return;
  }
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: trimmed },
    update: { value: trimmed },
  });
}

/** DiscordのIDはsnowflake（17〜20桁の数字） */
export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim());
}
