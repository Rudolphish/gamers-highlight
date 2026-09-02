import { db } from "./db";

/**
 * 「このアルバムの中身が変わった」を `updatedAt` に反映させる。
 *
 * **Prismaの `@updatedAt` は、そのアルバムの行を更新したときにしか動かない。**
 * 写真を作っても増えるのは `Photo` の行だけなので、**投稿してもアルバムは更新順で上がらない**。
 * 実際に「アルバムに投稿したのに更新順で上に来ない」という報告になった（2026-08-31）。
 *
 * しかも以前は経路によって割れていた——未分類からの振り分け（`photos/assign-album`）だけが
 * 更新していて、手動アップロード・Discord取り込み・`/tag`・Botの振り分けは更新していなかった。
 * **同じ「写真がアルバムに入る」なのに経路で結果が変わる**ので、ここに寄せてある。
 *
 * 影響は並び順だけではない。グループ画面は `updatedAt` の降順で**上位N件しか読まない**ので、
 * 更新されないアルバムは投稿が続いていても初期表示の窓から落ちる（クライアント側の並び替えは
 * 受け取った範囲内でしか効かないため、名前順にしても出てこない）。
 *
 * **写真が出ていく側では呼ばない。** 「消したら一番上に来た」は直感に反する。
 * 説明や❤️でも呼ばない（アルバムの中身の増減ではないため）。
 *
 * `groupId` を返すのは、呼び出し側が直後の `invalidateAlbumPhotos` で必ず要るから。
 * 引き直すと本番では1往復増える（`docs/perf-cache.md`）。
 */
export async function touchAlbum(albumId: string): Promise<string | null> {
  try {
    const album = await db.album.update({
      where: { id: albumId },
      data: touchData(),
      select: { groupId: true },
    });
    return album.groupId;
  } catch (e) {
    // 対象が消えている場合など。**本体の操作は止めない**——並び順が動かないだけで、
    // 投稿そのものは成功しているため（logActivity と同じ扱い方）
    console.error("[album] updatedAt の更新に失敗しました", albumId, e);
    return null;
  }
}

/**
 * **`data: {}` では更新されない。** Prisma（5.22で実測）は書く列が1つも無いと
 * UPDATE 自体を発行しないため、`@updatedAt` も動かない。**エラーにはならず、
 * 成功したように見えて何も起きない。** 実際に `photos/assign-album` が
 * 「アルバムのupdatedAtを更新して並び順に反映させる」というコメント付きで
 * `data: {}` を投げており、**ずっと何もしていなかった**（今回の調査で判明）。
 *
 * なので時刻を明示的に渡す。`@updatedAt` の列でも、値を渡せばその値が入る（実測）。
 */
function touchData() {
  return { updatedAt: new Date() };
}

/**
 * 本体の書き込みと同じ往復で更新するための引数。`$transaction` に並べて使う。
 * **こちらは失敗すると本体ごと巻き戻る**（同じトランザクションのため）。
 */
export function touchAlbumArgs(albumId: string) {
  return { where: { id: albumId }, data: touchData() };
}
