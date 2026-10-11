// Webのライブラリ関数を、Next.jsのリクエストの外から直接呼んで確かめる。
//
// **HTTPからは届かない処理のためだけに置く。** ログインの途中（NextAuthの signIn コールバック）で
// 動く処理は、DiscordのOAuthを通さないと呼ばれないので、総合テストからは叩けない。
// HTTPで叩けるものは flows / api-sweep で確かめること（ここに寄せない）。
//
// flows.mjs が tsx で起動し、標準出力の最後の1行（JSON）を受け取って表に載せる。
//   node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json tools/local-test/lib-checks.mts
import { randomUUID } from "node:crypto";
import { db } from "../../apps/web/src/lib/db";
import { consumeInviteForAllowlist } from "../../apps/web/src/lib/groupInvites";
import { adminEmails, isAdminConfigured, isAdminEmail } from "../../apps/web/src/lib/admin";

type Row = { id: string; item: string; ok: boolean; detail: string };
const rows: Row[] = [];
const check = (id: string, item: string, ok: boolean, detail: unknown = "") =>
  rows.push({ id, item, ok, detail: ok ? "" : String(typeof detail === "string" ? detail : JSON.stringify(detail)) });

// ── 管理者の判定は「未設定なら誰も管理者ではない」（フェイルクローズ） ──
// CIは ADMIN_EMAILS を設定した状態でしか流していないので、未設定の側はここでしか見られない
{
  const saved = process.env.ADMIN_EMAILS;
  try {
    delete process.env.ADMIN_EMAILS;
    const unset = { admin: isAdminEmail("admin@example.com"), configured: isAdminConfigured(), list: adminEmails() };
    process.env.ADMIN_EMAILS = "";
    const empty = { admin: isAdminEmail("admin@example.com"), configured: isAdminConfigured() };
    process.env.ADMIN_EMAILS = " , ,";
    const commas = { admin: isAdminEmail("admin@example.com"), empty: isAdminEmail("") };
    check(
      "F234",
      "ADMIN_EMAILS が未設定・空・区切りだけなら、誰も管理者にならない",
      !unset.admin && !unset.configured && unset.list.length === 0 && !empty.admin && !empty.configured && !commas.admin && !commas.empty,
      { unset, empty, commas }
    );
    process.env.ADMIN_EMAILS = "Admin@Example.com , other@example.com";
    check(
      "F235",
      "ADMIN_EMAILS は大文字小文字と空白の差を無視して照合する（載っていない人は弾く）",
      isAdminEmail("admin@example.com") && isAdminEmail(" ADMIN@example.com ") && !isAdminEmail("member@example.com"),
      adminEmails()
    );
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
}

// ── 1回限りの招待リンクを、誰も加入しないうちに3人が踏む ──
// ログインした時点で1回分を消費する作り（CLAUDE.md「招待リンクは『ログインした時点』で1回分を消費する」）。
// 以前は加入時にしか数えておらず、3人とも許可リストに載った
{
  const group = await db.group.findFirst({ where: { name: "テストグループ" }, select: { id: true, ownerId: true } });
  const token = `lib-check-${randomUUID()}`;
  const people = ["199000000000000001", "199000000000000002", "199000000000000003"];
  let inviteId: string | null = null;
  let extraInviteId: string | null = null;
  try {
    if (!group) throw new Error("seed のテストグループが無い");
    const invite = await db.groupInvite.create({
      data: {
        groupId: group.id,
        token,
        role: "VIEWER",
        maxUses: 1,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdById: group.ownerId,
      },
    });
    inviteId = invite.id;

    const results = [];
    for (const p of people) results.push(await consumeInviteForAllowlist(token, p));
    const entries = await db.allowlistEntry.count({ where: { inviteId: invite.id } });
    const after = await db.groupInvite.findUnique({ where: { id: invite.id }, select: { usedCount: true } });
    check(
      "F236",
      "1回限りのリンクを3人が踏んでも、許可リストに載るのは最初の1人だけ",
      // 2人目以降は「使い切り」として弾かれる（入口の有効性チェックで落ちるか、条件付き更新で落ちるかは問わない）
      results[0] === "registered" && results.slice(1).every((r) => r !== "registered") && entries === 1 && after?.usedCount === 1,
      { results, entries, usedCount: after?.usedCount }
    );

    // 同じ人がもう一度ログインしても、2回目は数えない（再ログインで枠が減らない）。
    // 1回限りのリンクだと使い切りで先に弾かれて確かめられないので、2回分のリンクで見る
    const token2 = `${token}-2`;
    const invite2 = await db.groupInvite.create({
      data: { groupId: group.id, token: token2, role: "VIEWER", maxUses: 2, expiresAt: new Date(Date.now() + 60 * 60 * 1000), createdById: group.ownerId },
    });
    extraInviteId = invite2.id;
    const first2 = await consumeInviteForAllowlist(token2, "199000000000000004");
    const again = await consumeInviteForAllowlist(token2, "199000000000000004");
    const after2 = await db.groupInvite.findUnique({ where: { id: invite2.id }, select: { usedCount: true } });
    check(
      "F237",
      "既に許可リストにいる人の再ログインでは枠を消費しない",
      first2 === "registered" && again === "already-allowed" && after2?.usedCount === 1,
      { first2, again, usedCount: after2?.usedCount }
    );

    const bogus = await consumeInviteForAllowlist("no-such-token", "199000000000000009");
    check("F238", "存在しないトークンでは許可リストに載らない", bogus === "invalid", bogus);
  } catch (e) {
    check("F236x", "招待の確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.allowlistEntry.deleteMany({
      where: { discordUserId: { in: [...people, "199000000000000004", "199000000000000009"] } },
    });
    await db.groupInvite.deleteMany({ where: { id: { in: [inviteId, extraInviteId].filter((x): x is string => !!x) } } });
  }
}

await db.$disconnect();
console.log(JSON.stringify(rows));
