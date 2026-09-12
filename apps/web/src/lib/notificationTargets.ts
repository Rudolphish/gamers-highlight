import { db } from "./db";
import type { GroupNotificationKind } from "@gamers-highlight/db";

// グループ単位の通知を、種類ごとにどのチャンネルへ送るか。
//
// **行が無い＝送らない。** 「送らない」を表す特別な値を作らずに済ませるため、
// 設定の有無そのもので表している（`GroupNotificationTarget`）。
//
// 2026-09-12 まではグループに1つの `notificationChannelId` があるだけで、
// 最安値の更新とBotの死活がそこへ送られていた。種類ごとに分けたいという要望で移した。
//
// **Botの死活はここに無い。** 運用の話で、グループのメンバーには関係がないため
// 管理者向けのチャンネル（`AppSetting.errorNotifyChannelId`）へ送っている。
// **移行前の設定は自動では引き継がれない**ので、
// `packages/db/backfill-notification-targets.ts` を1回流す必要がある。

/** 画面に出す並び順と説明。ここを増やせば設定画面にも行が増える */
export const NOTIFICATION_KINDS: {
  kind: GroupNotificationKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "PROPOSAL",
    label: "ゲームが提案されたとき",
    description: "ゲーム名・提案した人・採用に必要な「いいね」の数を送ります",
  },
  {
    kind: "PRICE_DROP",
    label: "ウィッシュリストが最安値を更新したとき",
    description: "毎日調べて、過去の最安値を更新したときだけ送ります",
  },
  {
    kind: "WEEKLY_SUMMARY",
    label: "週に一度のまとめ",
    description: "先週の投稿・クリア・提案などをまとめて送ります（動きが無かった週は送りません）",
  },
];

/** そのグループ・その種類の送り先。設定が無ければ null（＝送らない） */
export async function getNotificationChannel(
  groupId: string,
  kind: GroupNotificationKind
): Promise<string | null> {
  const target = await db.groupNotificationTarget.findUnique({
    where: { groupId_kind: { groupId, kind } },
    select: { channelId: true },
  });
  return target?.channelId ?? null;
}

/**
 * その種類の送り先を持つ全グループ。cron から使う。
 * **チャンネルIDが重複しうる**（種類は違っても同じチャンネルを指定できる）ので、
 * 同じチャンネルへ二重に送りたくない呼び出し側は自分で重複を除くこと。
 */
export async function listNotificationTargets(
  kind: GroupNotificationKind
): Promise<{ groupId: string; channelId: string }[]> {
  return db.groupNotificationTarget.findMany({
    where: { kind },
    select: { groupId: true, channelId: true },
  });
}
