/**
 * アルバムの `updatedAt` を「最後に投稿された写真の時刻」まで進める（過去ぶんの穴埋め）。
 *
 *   pnpm --filter @gamers-highlight/db backfill:album-updated           # 下見（何も書かない）
 *   pnpm --filter @gamers-highlight/db backfill:album-updated -- --apply # 実行
 *
 * **なぜ要るか。** `Album.updatedAt` は行を更新したときしか動かないため、
 * 2026-08-31 の修正までは**アルバムに投稿しても更新順が動かなかった**
 * （未分類からの振り分けだけが例外）。修正は今日から先にしか効かないので、
 * 過去の投稿ぶんはここで埋める。
 *
 * **既定は下見（dry-run）。** 実行するとホーム・アルバム一覧・グループ画面の並びが
 * まとめて組み替わる。見た目が変わる操作なので、明示的に `--apply` を付けたときだけ書く。
 *
 * **何度流しても同じ結果になる**（既に進んでいるアルバムは対象外）。
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const albums = await db.album.findMany({
    select: {
      id: true,
      title: true,
      updatedAt: true,
      photos: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // 対象は「最後の投稿がいまの updatedAt より新しい」アルバムだけ。
  // **updatedAt を過去に戻さない**——タイトルを編集しただけのアルバムを、
  // 古い写真の時刻まで引き下げてしまうと、今度はそれが下に沈む
  const targets = albums
    .map((a) => ({ ...a, lastPhotoAt: a.photos[0]?.createdAt ?? null }))
    .filter((a) => a.lastPhotoAt !== null && a.lastPhotoAt > a.updatedAt);

  console.log(`アルバム ${albums.length} 件中、進めるのは ${targets.length} 件`);
  for (const a of targets) {
    console.log(
      `  ${a.title}: ${a.updatedAt.toISOString()} → ${a.lastPhotoAt!.toISOString()}`
    );
  }

  if (targets.length === 0) {
    console.log("進めるものはありません（すべて最新の投稿に追いついています）");
    return;
  }

  if (!APPLY) {
    console.log("\n下見だけで終了しました。実行するには --apply を付けてください。");
    return;
  }

  // **列名は camelCase のまま**（`@@map` はテーブル名だけ、列に `@map` は無い）。
  // `updated_at` と書くと存在しない列でエラーになる。
  //
  // **生SQLで書く。** Prismaの `@updatedAt` は update のたびに現在時刻を入れるため、
  // 「過去の時刻を入れたい」というここの目的とは相性が悪い（明示指定が効くかは
  // バージョン依存で、黙って今の時刻になると穴埋めにならない）。SQLなら結果が一意に決まる。
  let updated = 0;
  for (const a of targets) {
    updated += await db.$executeRaw`
      UPDATE albums SET "updatedAt" = ${a.lastPhotoAt} WHERE id = ${a.id}
    `;
  }
  console.log(`\n${updated} 件を更新しました。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
