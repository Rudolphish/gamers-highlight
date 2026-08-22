import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { checkAlbumPermission } from "@/lib/permissions";
import { activityLogCreateArgs } from "@/lib/activityLog";

// POST /api/photos/:id/reactions … 写真への❤️をトグルする。
//
// 既に押していれば取り消し、押していなければ付ける。種類は1つだけなので、
// GroupGameInterest（ゲームの「気になる」）と同じ形。
//
// **権限はVIEWER以上。** 自分の反応を示すだけでアルバムの中身は変わらないため、
// 閲覧できる人なら誰でも押せる（GroupGameInterest と同じ考え方）。
// 自分の写真に自分で押すのも許可する（禁止する理由が無く、あちらも禁止していない）。
//
// **このルートはキャッシュを無効化しない。意図的にそうしている。**
// リアクションは `getAlbumPhotos` のキャッシュに載せず毎回引いているので、飛ばす対象が無い。
// 逆に無効化を足すと、1回押すたびに写真のキャッシュ（albumPhotosTag）が飛び、
// #43 で入れた効果が活発なアルバムほど消える。
//
// audit-invalidation: 無効化しない（リアクションはキャッシュに載せていないため飛ばす対象が無い）
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const photo = await db.photo.findUnique({
    where: { id: params.id },
    select: { id: true, albumId: true },
  });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  // **未分類の写真（albumId が null）には付けられない。**
  // アルバムに属さない写真は権限を判定する足場が無く、「誰が見てよいか」が決まらない。
  // 見えない相手の写真にリアクションが付く状態を作らないよう、ここで弾く。
  if (!photo.albumId) {
    return NextResponse.json(
      { error: "アルバムに入っていない写真にはリアクションできません" },
      { status: 400 }
    );
  }

  // groupId は活動ログの非正規化に使う。権限判定がどのみち album を読んでいるので追加コストは無い
  const { allowed, groupId } = await checkAlbumPermission(photo.albumId, user.id, "VIEWER");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await db.photoReaction.findUnique({
    where: { photoId_userId: { photoId: photo.id, userId: user.id } },
  });

  // **付けたときと外したときの両方を記録する。** トグルは行ごと消えるので、
  // 片方しか記録しないと「今週30件」が実際には35付いて5取り消された結果かもしれない、
  // という読み違えが起きる（docs/activity-log.md §10）。
  //
  // 本体と同じ $transaction に並べて1往復にまとめる。ログ側が失敗したら本体ごと戻るが、
  // ❤️は押し直せばよいので巻き添えの実害が小さい。
  const activity = activityLogCreateArgs({
    kind: existing ? "photo.reaction_removed" : "photo.reaction_added",
    targetId: photo.id,
    groupId,
    actorId: user.id,
  });

  if (existing) {
    await db.$transaction([
      db.photoReaction.delete({ where: { id: existing.id } }),
      db.activityLog.create(activity),
    ]);
  } else {
    await db.$transaction([
      // 連打で二重に入らないよう upsert にする（@@unique があるので create だと落ちる）
      db.photoReaction.upsert({
        where: { photoId_userId: { photoId: photo.id, userId: user.id } },
        create: { photoId: photo.id, userId: user.id },
        update: {},
      }),
      db.activityLog.create(activity),
    ]);
  }

  const count = await db.photoReaction.count({ where: { photoId: photo.id } });
  return NextResponse.json({ count, reacted: !existing });
}
