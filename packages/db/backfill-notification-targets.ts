/**
 * 種類ごとに分ける前の通知先（`Group.notificationChannelId`）を、
 * 新しい `GroupNotificationTarget` へ写す。
 *
 *   pnpm --filter @gamers-highlight/db backfill:notify           # 下見（何も書かない）
 *   pnpm --filter @gamers-highlight/db backfill:notify -- --apply # 実行
 *
 * **これを流さないと通知が全部止まる。** 2026-09-12 に送り先を種類ごとの表へ移した。
 * 「行が無い＝送らない」なので、移行前から設定していたグループは
 * **設定が空の状態＝通知オフ**として扱われる。エラーにはならず、静かに止まる。
 *
 * 画面側でも気づけるようにしてある（種類ごとの設定が0件なのに旧設定が残っている場合、
 * グループ画面に「引き継がれていません」と出る）が、こちらを流すのが正攻法。
 *
 * **既に設定がある種類は触らない**ので、何度流しても同じ結果になる。
 */
import { PrismaClient, type GroupNotificationKind } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// **移行前にこのチャンネルへ実際に送っていたのは「最安値の更新」だけ**なので、
// 素直に引き継ぐのはそれ1つ。
//
// 「ゲームが提案されたとき」も入れているのは、この通知自体が同じ回に足した新機能で、
// 欲しくて入れたものだから（要らなければ画面で「送らない」に戻せる）。
//
// **「週に一度のまとめ」は入れない。** 以前は管理者の1チャンネルへ流していたもので、
// グループのチャンネルへ勝手に向け直すと、これまで届いていなかった場所に届き始める。
// 受け取りたいグループが自分で選ぶ。
const KINDS: GroupNotificationKind[] = ["PRICE_DROP", "PROPOSAL"];

async function main() {
  const groups = await db.group.findMany({
    where: { notificationChannelId: { not: null } },
    select: {
      id: true,
      name: true,
      notificationChannelId: true,
      notificationTargets: { select: { kind: true } },
    },
  });

  if (groups.length === 0) {
    console.log("移行前の通知先が設定されているグループはありません。何もすることがありません。");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const group of groups) {
    const already = new Set(group.notificationTargets.map((t) => t.kind));
    const missing = KINDS.filter((k) => !already.has(k));

    if (missing.length === 0) {
      console.log(`- ${group.name}: 対象の種類はすべて設定済み。触らない`);
      skipped += KINDS.length;
      continue;
    }

    console.log(
      `${APPLY ? "→" : "[下見]"} ${group.name}: ${missing.join(" / ")} を ${group.notificationChannelId} に設定`
    );
    skipped += KINDS.length - missing.length;

    if (APPLY) {
      await db.groupNotificationTarget.createMany({
        data: missing.map((kind) => ({
          groupId: group.id,
          kind,
          channelId: group.notificationChannelId!,
        })),
      });
    }
    created += missing.length;
  }

  console.log(
    `\n${APPLY ? "書き込みました" : "下見（何も書いていません）"}: 作成 ${created} 件 / 既存のまま ${skipped} 件`
  );
  if (!APPLY && created > 0) {
    console.log("実行するには -- --apply を付けて流してください。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
