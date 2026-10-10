import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateAlbum } from "@/lib/cacheTags";
import { checkAlbumPermission, hasGroupPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { getOrFetchExternalGameData } from "@/lib/externalGameCache";

// PATCH /api/albums/:id/game … アルバムとグループのゲームの紐付けを「付け替える／解除する」
//
// body:
//   { steamAppId: number, title: string, coverUrl?: string, removePrevious?: boolean }
//     … そのゲームに付け替える。リストに無ければ追加する。
//       removePrevious を立てると、**それまで紐付いていたゲームをリストからも消す**
//       （連携を間違えたときの後片付け。画面では確認ダイアログを挟む）
//   { steamAppId: null }
//     … 紐付けを解除する。ゲームはリストに残し、アルバムのサムネイルも触らない
//
// **これが無いと間違えた連携を直せなかった。** `POST /api/groups/:id/games` は
// 「このアルバムは既に別のゲームと紐付いています」で409を返すだけで付け替える経路が無く、
// アルバムから辿るゲーム詳細が別のゲームのまま固定されていた（ユーザー報告）。
//
// 権限は**グループのEDITOR以上**。ゲームリストの中身（追加・削除）を触る操作なので、
// `/api/groups/:id/games` と同じ基準に揃える。アルバムを見られるだけの人には許さない。
const relinkSchema = z.union([
  z.object({
    steamAppId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    coverUrl: z.string().trim().url().optional(),
    removePrevious: z.boolean().optional(),
  }),
  z.object({ steamAppId: z.null() }),
]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = relinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // アルバムの存在と groupId は権限判定のついでに取る（判定が album.groupId を読んでいる）
  const permission = await checkAlbumPermission(params.id, user.id, "VIEWER");
  if (!permission.allowed || !permission.groupId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const groupId = permission.groupId;

  const canEditGames = await hasGroupPermission(groupId, user.id, "EDITOR");
  if (!canEditGames) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // いま紐付いているゲーム（無ければ null）
  const current = await db.groupGame.findUnique({
    where: { albumId: params.id },
    select: { id: true, steamAppId: true, title: true },
  });

  // ── 解除 ──────────────────────────────────────────────
  if (parsed.data.steamAppId === null) {
    if (!current) return NextResponse.json({ ok: true, game: null });

    await db.groupGame.update({ where: { id: current.id }, data: { albumId: null } });
    invalidateAlbum(params.id, groupId);
    return NextResponse.json({ ok: true, game: null });
  }

  // ── 付け替え ──────────────────────────────────────────
  const { steamAppId, title, coverUrl, removePrevious } = parsed.data;

  if (current && current.steamAppId === steamAppId) {
    // 既に同じゲームと紐付いている。サムネイルだけ揃えて終わる（冪等）
    await db.album.update({ where: { id: params.id }, data: { steamAppId } });
    invalidateAlbum(params.id, groupId);
    return NextResponse.json({ ok: true, game: { id: current.id, title: current.title } });
  }

  const target = await db.groupGame.findUnique({
    where: { groupId_steamAppId: { groupId, steamAppId } },
    select: { id: true, title: true, albumId: true },
  });

  // **他のアルバムの連携は奪わない。** 1ゲーム=1アルバムなので、奪うと相手側の
  // 「ゲーム詳細を見る」が黙って消える（同じ事故を別のアルバムで起こすことになる）
  if (target?.albumId && target.albumId !== params.id) {
    return NextResponse.json(
      { error: "このゲームは既に別のアルバムと連携しています" },
      { status: 409 }
    );
  }

  // リストに無ければ外部データ込みで作る（`POST /api/groups/:id/games` と同じ扱い）。
  // 取得は steamAppId 単位でキャッシュされるので、後から採用されても引き直さない
  let created: { id: string; title: string } | null = null;
  if (!target) {
    const { headerImage, ...external } = await getOrFetchExternalGameData(steamAppId, title);
    created = await db.groupGame.create({
      data: {
        groupId,
        steamAppId,
        title,
        // クライアントが送るcoverUrlは固定パスの組み立てで、新しめのタイトルだと404になる。
        // appdetailsの正しいURLが取れたらそちらを使う（CLAUDE.md）
        coverUrl: headerImage ?? coverUrl,
        ...external,
        addedById: user.id,
      },
      select: { id: true, title: true },
    });
  }

  const nextGameId = target?.id ?? created!.id;

  // **外す→付ける の順でないと通らない。** `GroupGame.albumId` は一意制約付きなので、
  // 先に新しい側へ付けると「このアルバムに2つ目」で落ちる。
  // 1トランザクションにまとめて、途中で失敗したときに紐付けが消えたままにならないようにする。
  await db.$transaction([
    ...(current
      ? [db.groupGame.update({ where: { id: current.id }, data: { albumId: null } })]
      : []),
    db.groupGame.update({ where: { id: nextGameId }, data: { albumId: params.id } }),
    // サムネイルも新しいゲームに合わせる（間違ったゲームの画像が残ると直った感じがしない）
    db.album.update({ where: { id: params.id }, data: { steamAppId } }),
  ]);

  // 間違えて追加したゲームの後片付け。**既定では消さない**——他のメンバーが
  // 「気になる」を付けているかもしれないため、消すかどうかは画面で選ばせる
  if (removePrevious && current) {
    await db.groupGame.delete({ where: { id: current.id } });
    await logActivity({
      kind: "game.removed",
      targetId: current.id,
      targetName: current.title,
      groupId,
      actorId: user.id,
    });
  }

  invalidateAlbum(params.id, groupId);

  if (created) {
    await logActivity({
      kind: "game.added",
      targetId: created.id,
      targetName: created.title,
      groupId,
      actorId: user.id,
      detail: { status: "WISHLIST" },
    });
  }

  return NextResponse.json({
    ok: true,
    game: { id: nextGameId, title: target?.title ?? created!.title },
    removedPrevious: Boolean(removePrevious && current),
  });
}
