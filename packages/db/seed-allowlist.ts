/**
 * 許可リストへメンバーを登録する初期セットアップ用スクリプト。
 * DiscordのユーザーIDは Discord本体の「開発者モード」をONにし、
 * ユーザーを右クリック→「ユーザーIDをコピー」で取得できる。
 *
 * 実行方法:
 *   pnpm --filter @gamers-highlight/db exec tsx seed-allowlist.ts
 *
 * または、初回だけならPrisma Studio（`pnpm db:studio`）から
 * allowlist_entries テーブルに直接1行ずつ追加してもよい。
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ここに友人4人ぶんを追加する
const MEMBERS = [
  { discordUserId: "REPLACE_ME_1", note: "ゆうき（自分）" },
  { discordUserId: "REPLACE_ME_2", note: "たける" },
  { discordUserId: "REPLACE_ME_3", note: "みさき" },
  { discordUserId: "REPLACE_ME_4", note: "そう" },
];

async function main() {
  for (const m of MEMBERS) {
    await db.allowlistEntry.upsert({
      where: { discordUserId: m.discordUserId },
      update: { note: m.note },
      create: m,
    });
    console.log(`registered: ${m.note} (${m.discordUserId})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
