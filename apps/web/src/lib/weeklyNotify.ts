import { db } from "./db";
import {
  APP_SETTING_KEYS,
  getAppSetting,
  getRawAppSetting,
  setRawAppSetting,
  weeklySummaryLastSentWeekKey,
} from "./appSettings";
import { getNotificationChannel } from "./notificationTargets";
import { postDiscordMessage } from "./discord";
import { jstDateString } from "./jst";
import { formatWeeklySummaryText, getWeeklySummary, jstWeekRange } from "./weeklySummary";

/**
 * 週次まとめのDiscord通知。日次cron（check-bot-health）から呼ばれる。
 *
 * **Botのプロセスは関与しない。** `postDiscordMessage` はDiscordのREST APIに
 * 直接POSTしているので、`apps/bot` が落ちていても届く（Botが落ちたことを知らせる
 * 警告が同じ経路なのと同じ理由）。必要なのはBotがそのサーバーに参加していて、
 * そのチャンネルに投稿できることだけ。
 *
 * **送り先はグループごと**（`GroupNotificationTarget` の `WEEKLY_SUMMARY`）。
 * そのグループのまとめを、そのグループが決めたチャンネルへ送る。設定が無ければ送らない。
 * 2026-09-12 まではグループを問わず管理者の1チャンネルへまとめて流していた。
 *
 * 管理者の `weeklySummaryChannelId` は**手動送信（動作確認）の宛先**として残してある。
 * 自動送信はもうこの設定を見ない。
 */

/**
 * 「曜日が月曜なら送る」にしていない理由。
 *
 * その日のcronが失敗すると、**その週は永久に送られない**。cronは自分の管理外で
 * 落ちうる（Vercel側の都合、デプロイ中、関数のタイムアウト）。
 *
 * 代わりに「最後に送った週」を記録して、**完了した週がそれより新しければ送る**。
 * こうすると、
 *   - cronが数日飛んでも、次に動いた時に送られる（取りこぼさない）
 *   - 同じ週を二度送らない（記録を見るので）
 *   - 送る曜日を決めなくてよい（週が終わってさえいれば、いつ動いても正しい）
 */
export type WeeklyNotifyResult = {
  /** 送る対象だった週（未送信の完了週が無ければ null） */
  week: string | null;
  /** 実際に投稿したグループ数 */
  posted: number;
  /** 動きが無くて送らなかったグループ数 */
  skippedQuiet: number;
  /** 送ろうとして投稿に失敗したグループ数。**1件でもあれば記録を進めない** */
  failed: number;
  /** 送らなかった理由（チャンネル未設定など）。送った場合は null */
  reason: string | null;
};

/** 通知の対象になるのは「完了した週」だけ。進行中の今週は送らない */
function lastCompletedWeek(now: Date) {
  return jstWeekRange(-1, now);
}

/**
 * 未送信の完了週があれば送る。無ければ何もしない。
 *
 * **飛ばした週はまとめて送らない。** cronが1か月止まっていた場合、
 * 過去4週ぶんを一気に投げても読まれない（それに、その頃の話を今さら知らせても仕方ない）。
 * いちばん新しい完了週だけを送って、記録をそこまで進める。
 */
export async function sendWeeklySummaryIfDue(now = new Date()): Promise<WeeklyNotifyResult> {
  const week = lastCompletedWeek(now);
  const weekKey = jstDateString(week.start);

  // **「送信済み」はグループごとに持つ。** 送り先がグループごとになったので、
  // 1グループへの投稿が失敗しただけで全グループへ再送するのは正しくない。
  // 記録がまだ無いグループは、グループ別に分ける前の値を初期値として読む
  // （そうしないと、移行した直後に先週ぶんが全グループへ一斉に流れる）。
  const legacyLastSent = await getAppSetting(APP_SETTING_KEYS.weeklySummaryLastSentWeek);

  const groups = await db.group.findMany({ select: { id: true }, orderBy: { name: "asc" } });

  let posted = 0;
  let skippedQuiet = 0;
  let failed = 0;
  let hadTarget = false;

  for (const group of groups) {
    const channelId = await getNotificationChannel(group.id, "WEEKLY_SUMMARY");
    if (!channelId) continue; // このグループは週次まとめを受け取らない
    hadTarget = true;

    const key = weeklySummaryLastSentWeekKey(group.id);
    const lastSent = (await getRawAppSetting(key)) ?? legacyLastSent;
    if (lastSent && lastSent >= weekKey) continue; // このグループには送信済み

    const result = await postWeeklySummaryToGroup(group.id, channelId, -1, now);
    posted += result.posted;
    skippedQuiet += result.skippedQuiet;
    failed += result.failed;

    // **投稿に失敗したら記録を進めない。**
    // 進めてしまうと、BotがサーバーからKickされた・権限を外された・Discordが落ちていた、
    // といった一時的な失敗でその週の通知が永久に失われる（次のcronでも再送されない）。
    // 「cronが飛んでも取りこぼさない」ためにこの仕組みを作ったのに、そこが抜けていた
    // （後追いレビューの指摘）。
    //
    // **動きが無くて送らなかった場合は記録を進める。** そちらは失敗ではないので、
    // 進めないと毎日ここまで来て毎日集計し直すことになる（結果は同じで、無駄なだけ）。
    if (result.failed === 0) {
      await setRawAppSetting(key, weekKey);
    }
  }

  if (!hadTarget) {
    // **記録を進めない。** 進めてしまうと、後からチャンネルを設定しても
    // その週は「送信済み」として飛ばされる。
    return { week: weekKey, posted: 0, skippedQuiet: 0, failed: 0, reason: "通知先が未設定" };
  }

  const nothingToDo = posted === 0 && skippedQuiet === 0 && failed === 0;
  return {
    week: nothingToDo ? null : weekKey,
    posted,
    skippedQuiet,
    failed,
    reason: failed > 0
      ? "投稿に失敗したので記録を進めない（次回再送する）"
      : nothingToDo
        ? "この週は送信済み"
        : null,
  };
}

/** 1グループぶんのまとめを投稿する。動きが無ければ送らない */
async function postWeeklySummaryToGroup(
  groupId: string,
  channelId: string,
  weekOffset: number,
  now: Date
): Promise<{ posted: number; skippedQuiet: number; failed: number }> {
  const summary = await getWeeklySummary(groupId, weekOffset, now);
  if (!summary.hasActivity) return { posted: 0, skippedQuiet: 1, failed: 0 };

  // **画面のプレビューと同じ関数を通す。** 別々に組み立てると、
  // 管理画面で整えた文面と実際に飛ぶ文面がずれる。
  const ok = await postDiscordMessage(channelId, formatWeeklySummaryText(summary));
  if (ok) return { posted: 1, skippedQuiet: 0, failed: 0 };

  console.error("[weekly] 投稿に失敗しました", groupId);
  return { posted: 0, skippedQuiet: 0, failed: 1 };
}

/**
 * 指定した週のまとめを、**1つのチャンネルへ**グループごとに1通ずつ投稿する。
 * 管理画面の手動送信（動作確認）専用で、自動送信はこちらを使わない
 * （自動送信の宛先はグループごと。`sendWeeklySummaryIfDue`）。
 *
 * **動きが無かったグループは送らない。** 毎週「動きがありませんでした」が鳴ると
 * 読み飛ばされるようになり、本当に見てほしい週に効かなくなる
 * （`usageAlerts` で同じ判断をしている）。
 */
export async function postWeeklySummaries(
  channelId: string,
  weekOffset: number,
  now = new Date()
): Promise<{ posted: number; skippedQuiet: number; failed: number }> {
  const groups = await db.group.findMany({ select: { id: true }, orderBy: { name: "asc" } });

  let posted = 0;
  let skippedQuiet = 0;
  let failed = 0;
  for (const group of groups) {
    const summary = await getWeeklySummary(group.id, weekOffset, now);
    if (!summary.hasActivity) {
      skippedQuiet++;
      continue;
    }
    // **画面のプレビューと同じ関数を通す。** 別々に組み立てると、
    // 管理画面で整えた文面と実際に飛ぶ文面がずれる。
    const ok = await postDiscordMessage(channelId, formatWeeklySummaryText(summary));
    if (ok) {
      posted++;
    } else {
      // **失敗を数える。** 呼び出し元はこれを見て「記録を進めるか」を決める。
      // ログに出すだけだと、失敗しても送信済みとして扱われて週ごと失われる
      failed++;
      console.error("[weekly] 投稿に失敗しました", group.id);
    }
  }

  return { posted, skippedQuiet, failed };
}
