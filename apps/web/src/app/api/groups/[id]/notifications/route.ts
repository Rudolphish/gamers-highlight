import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateGroup } from "@/lib/cacheTags";
import { hasGroupPermission } from "@/lib/permissions";
import { NOTIFICATION_KINDS } from "@/lib/notificationTargets";
import type { GroupNotificationKind } from "@gamers-highlight/db";

// PATCH /api/groups/:id/notifications … 通知の種類ごとに送り先チャンネルを決める（OWNERのみ）
// body: { kind: GroupNotificationKind, channelId: string }
//
// **channelId を空にすると「その種類は送らない」。** 行を消すことで表現するので、
// 「送らない」用の特別な値を持たない（lib/notificationTargets.ts）。
//
// audit-activity-log: 意図的に記録しない（通知先の設定変更は「出来事」ではない。
// カレンダーに並べても、見たいもの——写真とゲームの動き——が埋もれるだけ）
// **受け付ける種類は画面と同じ一覧から作る。** ここに値を書き写すと、
// 種類を足し引きしたときに片方だけ古くなる（実際に BOT_HEALTH を外したとき、
// ここだけ残って型エラーで気づいた）
const KINDS = NOTIFICATION_KINDS.map((k) => k.kind) as [
  GroupNotificationKind,
  ...GroupNotificationKind[],
];

const patchSchema = z.object({
  kind: z.enum(KINDS),
  // Discordのチャンネルは snowflake（15〜25桁の数字）。空文字は「送らない」
  channelId: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{15,25}$/.test(v), {
      message: "channelId must be a Discord snowflake ID",
    }),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 通知先はグループ全員の目に触れる場所を決める設定なので、既存の通知先設定と同じくOWNERのみ
  const isOwner = await hasGroupPermission(params.id, user.id, "OWNER");
  if (!isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { kind, channelId } = parsed.data;
  const where = { groupId_kind: { groupId: params.id, kind } };

  if (channelId === "") {
    // 設定が無い状態から「送らない」を選び直しても落ちないようにする
    await db.groupNotificationTarget.deleteMany({ where: { groupId: params.id, kind } });
  } else {
    await db.groupNotificationTarget.upsert({
      where,
      create: { groupId: params.id, kind, channelId },
      update: { channelId },
    });
  }

  // グループ詳細に設定が出るので取り直させる
  invalidateGroup(params.id);

  const targets = await db.groupNotificationTarget.findMany({
    where: { groupId: params.id },
    select: { kind: true, channelId: true },
  });
  return NextResponse.json({ targets });
}
