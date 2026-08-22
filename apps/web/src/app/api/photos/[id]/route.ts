import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { invalidateAlbumPhotos } from "@/lib/cacheTags";
import { checkAlbumPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { deleteStoredObjects } from "@/lib/storage";
import { isAdminEmail } from "@/lib/admin";
import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/photoDescription";

const patchSchema = z.object({
  // 空文字＝説明を消す。nullでも同じ扱いにする（クライアントの実装差で落ちないように）
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable(),
});

// PATCH /api/photos/:id … 写真の説明を書き換える。
//
// **1枚につき1つ。** コメントのように積み上がるものではなく、
// そのアルバムを見られる人なら誰でも書き換えられる共有の情報として扱う。
//
// 権限を「見られる人」にしているのは、**アルバムのEDITORにすると実質書けなくなる**ため。
// Discord経由で自動作成されるアルバムには AlbumMember が1件も作られず、
// グループのメンバーは配下のアルバムに VIEWER しか持たない（lib/permissions.ts 参照）。
// EDITOR を要求すると、書けるのはアルバムを作った本人だけになる。
//
// 同時編集は後勝ち。友人内で使う規模なので競合制御は入れない。
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const photo = await db.photo.findUnique({
    where: { id: params.id },
    // description も読むのは、活動ログで「新しく書かれた」のか「書き直された」のかを
    // 区別するため（descriptionUpdatedAt は上書きされるので後からは分からない）
    select: { id: true, albumId: true, description: true },
  });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 未分類の写真（albumIdがnull）は対象外。権限を判定する足場が無いため。
  // リアクション（/api/photos/:id/reactions）と揃えてある。
  if (!photo.albumId) {
    return NextResponse.json(
      { error: "アルバムに入っていない写真には説明を付けられません" },
      { status: 400 }
    );
  }

  // groupId は下のキャッシュ無効化と活動ログの両方で使う。
  // 権限判定がどのみち album を読んでいるので、ここで受け取れば引き直さずに済む。
  const { allowed, groupId } = await checkAlbumPermission(photo.albumId, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 前後の空白だけの入力は「消した」とみなす（見えない文字だけが残るのを防ぐ）
  const text = (parsed.data.description ?? "").trim();
  const description = text.length > 0 ? text : null;

  const updated = await db.photo.update({
    where: { id: photo.id },
    data: {
      description,
      // 消したときは書き手の記録も消す（誰も書いていない状態に戻す）
      descriptionUpdatedById: description ? user.id : null,
      descriptionUpdatedAt: description ? new Date() : null,
    },
    select: {
      description: true,
      descriptionUpdatedAt: true,
      descriptionEditor: { select: { name: true, email: true } },
    },
  });

  // **説明は getAlbumPhotos のキャッシュに載っている。**
  // リアクションと違い滅多に書き換わらないので載せる判断にした。そのぶんここで飛ばす。
  invalidateAlbumPhotos(photo.albumId, groupId);

  // 説明の編集は descriptionUpdatedAt の上書きなので、**回数も「消した」も後から辿れない**。
  // ここで記録しておかないと永久に分からなくなる（docs/activity-log.md §1）。
  await logActivity({
    kind: description ? "photo.description_set" : "photo.description_cleared",
    targetId: photo.id,
    groupId,
    actorId: user.id,
    detail: description ? { first: photo.description === null } : undefined,
  });

  return NextResponse.json({
    description: updated.description,
    descriptionUpdatedAt: updated.descriptionUpdatedAt?.toISOString() ?? null,
    descriptionEditorName:
      updated.descriptionEditor?.name ?? updated.descriptionEditor?.email ?? null,
  });
}

// DELETE /api/photos/:id
// アップロード自体を取り消す用途に使う。レコードとあわせてストレージの実体も消す。
// 投稿者本人、またはそのアルバムのOWNERが削除できる
// （未分類=albumIdなしの写真は投稿者本人のみ）。
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const photo = await db.photo.findUnique({ where: { id: params.id } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isUploader = photo.uploaderId === user.id;
  const albumPermission = photo.albumId
    ? await checkAlbumPermission(photo.albumId, user.id, "OWNER")
    : null;
  const isAlbumOwner = albumPermission?.allowed ?? false;
  const groupId = albumPermission?.groupId ?? null;
  // 管理者は/adminのメディア一覧から横断的に消せる。容量が逼迫したときに
  // 誰の投稿かに関わらず整理できないと、管理画面の意味がないため。
  const isAdmin = isAdminEmail(session?.user?.email);
  if (!isUploader && !isAlbumOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.photo.delete({ where: { id: params.id } });

  // DBから消した後にストレージの実体も消す（この順序なので、消し漏らしても
  // 「消えたはずのものが見える」状態にはならない）。
  //
  // ただし他のレコードがまだ参照しているURLは残す。動画のthumbnailUrlには
  // 別の写真のmediaUrlを指定できるため、消してしまうとその写真が見えなくなる。
  const urls = [photo.mediaUrl, photo.thumbnailUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  const stillReferenced = new Set(
    (
      await db.photo.findMany({
        where: { OR: [{ mediaUrl: { in: urls } }, { thumbnailUrl: { in: urls } }] },
        select: { mediaUrl: true, thumbnailUrl: true },
      })
    ).flatMap((p) => [p.mediaUrl, p.thumbnailUrl])
  );

  await deleteStoredObjects(urls.filter((u) => !stillReferenced.has(u)));

  if (photo.albumId) {
    invalidateAlbumPhotos(photo.albumId, groupId);
  }

  // 削除は行ごと消えるので、記録しないと「今週何枚消えたか」が永久に分からない。
  // targetName にゲーム名を控えるのは、写真が消えた後に「何の写真だったか」を
  // 出せるようにするため（IDだけだと画面に出しても意味が読めない）。
  await logActivity({
    kind: "photo.deleted",
    targetId: photo.id,
    targetName: photo.gameTitle,
    groupId,
    actorId: user.id,
  });

  return NextResponse.json({ ok: true });
}
