import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import {
  APP_SETTING_KEYS,
  getAppSetting,
  isDiscordSnowflake,
  setAppSetting,
} from "@/lib/appSettings";
import { postWeeklySummaries } from "@/lib/weeklyNotify";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return isAdminEmail(session?.user?.email);
}

// PUT /api/admin/weekly-notify … 週次まとめの投稿先チャンネルIDを保存する（管理者のみ）
// body: { channelId }（空文字で解除）
//
// **エラー通知先とは別のキーに持つ。** 用途が違うものを同じチャンネル設定に
// まとめると、片方だけ止めたくなったときに困る。
export async function PUT(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";

  if (channelId && !isDiscordSnowflake(channelId)) {
    return NextResponse.json({ error: "チャンネルIDは17〜20桁の数字です" }, { status: 400 });
  }

  await setAppSetting(APP_SETTING_KEYS.weeklySummaryChannelId, channelId);
  return NextResponse.json({ ok: true, channelId: channelId || null });
}

// POST /api/admin/weekly-notify … いま見ている週のまとめを手動で投稿する（管理者のみ）。
// body: { week }（0=今週、-1=先週。既定は -1）
//
// **これが無いと動作確認に丸1日かかる。** 自動送信は日次cronに乗っているので、
// 文面や通知先を直したときに次のcronまで確かめられない。
//
// 送信済みの記録（weeklySummaryLastSentWeek）は**進めない**。手で送るのは確認のためで、
// 「その週の自動送信を済ませたことにする」意味ではない。
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const week = Number.isInteger(body?.week) ? (body.week as number) : -1;

  const channelId = await getAppSetting(APP_SETTING_KEYS.weeklySummaryChannelId);
  if (!channelId) {
    return NextResponse.json({ error: "通知先が未設定です" }, { status: 400 });
  }

  const { posted, skippedQuiet, failed } = await postWeeklySummaries(channelId, week);

  if (posted === 0) {
    return NextResponse.json({
      ok: true,
      posted,
      skippedQuiet,
      failed,
      // 「押したのに何も起きない」に見えるので、送らなかった理由を返す
      note:
        failed > 0
          ? "投稿できませんでした。Botがそのサーバーに参加していて、投稿権限があるか確認してください"
          : "この週は動きが無かったので送っていません（自動送信でも送りません）",
    });
  }

  return NextResponse.json({ ok: true, posted, skippedQuiet, failed });
}
