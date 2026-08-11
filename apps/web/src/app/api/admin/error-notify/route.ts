import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { APP_SETTING_KEYS, getAppSetting, setAppSetting, isDiscordSnowflake } from "@/lib/appSettings";
import { postDiscordMessage } from "@/lib/discord";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return isAdminEmail(session?.user?.email);
}

// PUT /api/admin/error-notify … エラー通知の投稿先チャンネルIDを保存する（管理者のみ）
// body: { channelId }（空文字で解除）
export async function PUT(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";

  if (channelId && !isDiscordSnowflake(channelId)) {
    return NextResponse.json(
      { error: "チャンネルIDは17〜20桁の数字です" },
      { status: 400 }
    );
  }

  await setAppSetting(APP_SETTING_KEYS.errorNotifyChannelId, channelId);
  return NextResponse.json({ ok: true, channelId: channelId || null });
}

// POST /api/admin/error-notify … 保存済みのチャンネルへテスト投稿する（管理者のみ）。
// IDが正しくても、Botがそのサーバーに居ない・権限が無ければ届かない。
// 実際に投げてみないと分からないので、設定画面から確認できるようにしておく。
export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const channelId = await getAppSetting(APP_SETTING_KEYS.errorNotifyChannelId);
  if (!channelId) {
    return NextResponse.json({ error: "チャンネルIDが未設定です" }, { status: 400 });
  }

  const posted = await postDiscordMessage(
    channelId,
    "✅ ShareStaqのエラー通知のテストです。このメッセージが見えていれば設定は正しく動いています。"
  );
  if (!posted) {
    return NextResponse.json(
      {
        error:
          "投稿できませんでした。チャンネルIDが正しいか、Botがそのサーバーに参加していて投稿権限があるかを確認してください。",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
