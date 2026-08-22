import { db } from "./db";
import { APP_SETTING_KEYS, getAppSetting, setAppSetting } from "./appSettings";
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
 * **送り先は管理者が決めた1つのチャンネル**（`weeklySummaryChannelId`）。
 * いまは管理者が様子を見るための機能なので、グループの通知先には送らない。
 * グループ配信に広げるときは、送信先の解決だけ差し替えれば済む。
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

  const lastSent = await getAppSetting(APP_SETTING_KEYS.weeklySummaryLastSentWeek);
  if (lastSent && lastSent >= weekKey) {
    return { week: null, posted: 0, skippedQuiet: 0, reason: "この週は送信済み" };
  }

  const channelId = await getAppSetting(APP_SETTING_KEYS.weeklySummaryChannelId);
  if (!channelId) {
    // **記録を進めない。** 進めてしまうと、後からチャンネルを設定しても
    // その週は「送信済み」として飛ばされる。
    return { week: weekKey, posted: 0, skippedQuiet: 0, reason: "通知先が未設定" };
  }

  const result = await postWeeklySummaries(channelId, -1, now);

  // **動きが無くて1件も送らなかった場合も記録は進める。**
  // 進めないと毎日ここまで来て毎日集計し直すことになる（結果は同じで、無駄なだけ）。
  await setAppSetting(APP_SETTING_KEYS.weeklySummaryLastSentWeek, weekKey);

  return { week: weekKey, ...result, reason: null };
}

/**
 * 指定した週のまとめを、グループごとに1通ずつ投稿する。
 *
 * **動きが無かったグループは送らない。** 毎週「動きがありませんでした」が鳴ると
 * 読み飛ばされるようになり、本当に見てほしい週に効かなくなる
 * （`usageAlerts` で同じ判断をしている）。
 */
export async function postWeeklySummaries(
  channelId: string,
  weekOffset: number,
  now = new Date()
): Promise<{ posted: number; skippedQuiet: number }> {
  const groups = await db.group.findMany({ select: { id: true }, orderBy: { name: "asc" } });

  let posted = 0;
  let skippedQuiet = 0;
  for (const group of groups) {
    const summary = await getWeeklySummary(group.id, weekOffset, now);
    if (!summary.hasActivity) {
      skippedQuiet++;
      continue;
    }
    // **画面のプレビューと同じ関数を通す。** 別々に組み立てると、
    // 管理画面で整えた文面と実際に飛ぶ文面がずれる。
    const ok = await postDiscordMessage(channelId, formatWeeklySummaryText(summary));
    if (ok) posted++;
    else console.error("[weekly] 投稿に失敗しました", group.id);
  }

  return { posted, skippedQuiet };
}
