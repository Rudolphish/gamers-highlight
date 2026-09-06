import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateAlbum } from "@/lib/cacheTags";
import { hasAlbumPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { cacheSteamHeaderImage } from "@/lib/albumCover";
import { MAX_ALBUM_DESCRIPTION_LENGTH, MAX_ALBUM_TITLE_LENGTH } from "@/lib/albumFields";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const album = await db.album.findUnique({
    where: { id: params.id },
    include: { members: true },
  });
  if (!album) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ album });
}

// 送られてきた項目だけを更新する。**全部 optional。** 画面はサムネイル設定なら
// `{steamAppId}` だけ、名前の変更なら `{title}` だけを送ってくる。
// 検証が無かった頃は `title: ""` がそのまま保存でき、名前の無いアルバムが作れた。
const updateAlbumSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(MAX_ALBUM_TITLE_LENGTH).optional(),
  description: z.string().trim().max(MAX_ALBUM_DESCRIPTION_LENGTH).nullable().optional(),
  steamAppId: z.number().int().positive().nullable().optional(),
});

// PATCH /api/albums/:id … OWNER/EDITORのみ更新可
// audit-activity-log: 意図的に記録しない（アルバム名や説明の手直しは「出来事」ではない。
// カレンダーに『アルバム名を変えた』が並ぶと、見たいもの——写真とゲームの動き——が埋もれる）
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "EDITOR");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = updateAlbumSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // **undefined と null を区別する。** 省略された項目は触らない（`undefined` を渡すと
  // Prismaはその列を更新しない）が、`null` は「解除する」という指示なのでそのまま渡す。
  // 作成時（POST /api/albums）と同じ上限・同じ trim を使う——別々に書くと
  // 「作れるのに直せない」名前ができる。
  const album = await db.album.update({
    where: { id: params.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      steamAppId: parsed.data.steamAppId,
    },
  });

  // サムネイルに使う正しいURLを控えておく（無いと組み立てURLに落ちて空表示になる）
  if (typeof parsed.data.steamAppId === "number") {
    await cacheSteamHeaderImage(parsed.data.steamAppId);
  }

  // タイトル・カバーはアルバム詳細にもグループ詳細にも出るので両方飛ばす
  invalidateAlbum(album.id, album.groupId);

  return NextResponse.json({ album });
}

// DELETE /api/albums/:id … OWNERのみ削除可
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const allowed = await hasAlbumPermission(params.id, user.id, "OWNER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 削除後には辿れないので、先にグループと名前を控える
  // （グループ詳細のアルバム一覧を飛ばすため＋活動ログに残すため。
  //  ログにIDしか無いと、消えた後の画面に出しても何のことか読めない）
  const target = await db.album.findUnique({
    where: { id: params.id },
    select: { groupId: true, title: true },
  });

  // ハッシュタグ/チャンネルマッピングがこのアルバムをautoAlbumIdとして参照している場合、
  // 外部キー制約で削除がブロックされるため、アルバムと一緒に紐付けも削除する
  await db.$transaction([
    db.discordGameTag.deleteMany({ where: { autoAlbumId: params.id } }),
    db.discordChannelMapping.deleteMany({ where: { autoAlbumId: params.id } }),
    db.album.delete({ where: { id: params.id } }),
  ]);
  invalidateAlbum(params.id, target?.groupId);

  await logActivity({
    kind: "album.deleted",
    targetId: params.id,
    targetName: target?.title ?? null,
    groupId: target?.groupId ?? null,
    actorId: user.id,
  });

  return NextResponse.json({ ok: true });
}
