import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invalidateAlbumPhotos } from "@/lib/cacheTags";
import { resolveOrCreateAlbum, resolveByNameAndCreate } from "@/lib/gameIdentify";

/**
 * Botの「どのゲーム？」への返答を反映する内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * POST /api/internal/assign-game
 * body: { guildId, messageId, discordUserId, steamAppId? , query? }
 *
 * steamAppId … 候補から選ばれた場合
 * query      … 自由入力の場合。Steamを名前で検索し、ゲームリストへの登録と
 *               アルバム作成までまとめて行う（どちらも既にあれば使い回す）
 *
 * **1メッセージ分をまとめて更新する。** 添付が複数あっても聞くのは1回で済ませたいため、
 * discordMessageId が `<messageId>:<attachmentId>` である前提で前方一致で拾う。
 *
 * 更新するのは**まだゲームが決まっていない投稿だけ**。ハッシュタグやチャンネル設定で
 * 既に分類済みのものを、後からの選択で塗り替えないようにする。
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { guildId, messageId, discordUserId, steamAppId, query } = await req.json();
  const hasQuery = typeof query === "string" && query.trim().length > 0;
  if (!guildId || !messageId || !discordUserId || (!Number.isInteger(steamAppId) && !hasQuery)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const group = await db.group.findUnique({ where: { guildId }, select: { id: true } });
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const user = await db.user.findUnique({ where: { discordUserId } });
  if (!user) return NextResponse.json({ error: "user not linked" }, { status: 404 });

  // 自分が投稿したものだけ。他人のスクショに横から別のゲームを付けられないようにする。
  const targets = await db.photo.findMany({
    where: {
      discordMessageId: { startsWith: `${messageId}:` },
      uploaderId: user.id,
      gameTitle: null,
    },
    select: { id: true },
  });

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const resolved = hasQuery
    ? await resolveByNameAndCreate(query.trim(), group.id, user.id)
    : await resolveOrCreateAlbum(steamAppId, group.id, user.id);

  if (!resolved) {
    return NextResponse.json(
      { error: hasQuery ? "ゲームが見つかりませんでした" : "game not found" },
      { status: 404 }
    );
  }

  await db.photo.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { gameTitle: resolved.gameTitle, albumId: resolved.albumId },
  });

  if (resolved.albumId) {
    invalidateAlbumPhotos(resolved.albumId, group.id);
  }

  return NextResponse.json({
    ok: true,
    updated: targets.length,
    gameTitle: resolved.gameTitle,
  });
}
