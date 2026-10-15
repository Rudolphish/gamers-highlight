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
import { linkDiscordUser, isStillAllowed } from "../../apps/web/src/lib/discordAccount";
import { authOptions } from "../../apps/web/src/lib/auth";
import { isCronRequest } from "../../apps/web/src/lib/cronAuth";
import { describeDbError } from "../../apps/web/src/lib/dbError";
import { classifyAuthError } from "../../apps/web/src/lib/authErrorLog";

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

// ── ログインの照合は Discord のユーザーID。未確認のメールアドレスは信用しない（2026-10-15 脆弱性チェック） ──
// 以前はメールアドレスで User を upsert しており、他人の古いアドレスを名乗ると他人の行に入れた
{
  const A = "198000000000000001"; // 乗っ取られる側
  const B = "198000000000000002"; // 名乗る側（許可リストにいるメンバー）
  const C = "198000000000000003"; // 未確認のアドレスで初めて来る人
  const mail = (s: string) => `${s}-${randomUUID().slice(0, 8)}@example.com`;
  const victimMail = mail("victim");
  const freeMail = mail("free");
  const allowMail = mail("allow");
  const ids = [A, B, C];
  try {
    const victim = await db.user.create({ data: { email: victimMail, name: "被害者", provider: "discord", discordUserId: A } });
    await db.user.create({ data: { email: mail("b"), name: "メンバーB", provider: "discord", discordUserId: B } });

    // B がAさんの（いまは Discord 側で空いた）アドレスを確認済みとして名乗っても、Aさんの行には入らない
    const asB = await linkDiscordUser({ discordUserId: B, email: victimMail, emailVerified: true, name: "B", image: null });
    // 結びついていない Discord ID がAさんのアドレスで来ても、Aさんの行には結ばない
    const asNew = await linkDiscordUser({ discordUserId: "198000000000000009", email: victimMail, emailVerified: true, name: "?", image: null });
    const victimAfter = await db.user.findUnique({ where: { id: victim.id }, select: { discordUserId: true, email: true } });
    check(
      "F279",
      "他人のメールアドレスを名乗っても他人の行には入れない（照合は Discord のユーザーID）",
      asB.ok && asB.userId !== victim.id && !asNew.ok && victimAfter?.discordUserId === A && victimAfter?.email === victimMail,
      { asB, asNew, victimAfter }
    );

    // 未確認のアドレスは保存しない・許可リストのメール照合にも使わない
    const asC = await linkDiscordUser({ discordUserId: C, email: freeMail, emailVerified: false, name: "C", image: null });
    const cRow = asC.ok ? await db.user.findUnique({ where: { id: asC.userId }, select: { email: true } }) : null;
    await db.allowlistEntry.create({ data: { email: allowMail, note: "lib-checks: メールだけの登録" } });
    const signIn = authOptions.callbacks!.signIn!;
    const tryLogin = (verified: boolean) =>
      signIn({
        user: { id: "x", email: allowMail, name: "D", image: null },
        account: { provider: "discord", providerAccountId: "198000000000000004", type: "oauth" },
        profile: { verified } as never,
      } as never);
    const unverified = await tryLogin(false);
    const verified = await tryLogin(true);
    check(
      "F280",
      "Discord で未確認のメールアドレスは保存せず、許可リストのメール照合にも使わない（確認済みなら通る）",
      asC.ok && cRow?.email === null && unverified === false && verified === true,
      { asC, cRow, unverified, verified }
    );
    ids.push("198000000000000004");

    // jwt：サインインの回は Discord ID で行を引き、メールは DB の値にする（Discord から来た値ではなく）
    const jwt = authOptions.callbacks!.jwt!;
    const signedIn = await jwt({
      token: { email: victimMail },
      user: { id: "x", email: victimMail },
      account: { provider: "discord", providerAccountId: B, type: "oauth" },
    } as never);
    const bRow = await db.user.findUnique({ where: { discordUserId: B }, select: { id: true, email: true } });
    check(
      "F281",
      "ログインの回は Discord ID で本人の行を引き、管理者の判定に使うメールも DB の値にする",
      signedIn.userId === bRow?.id && signedIn.email === bRow?.email && signedIn.email !== victimMail,
      { signedIn: { userId: signedIn.userId, email: signedIn.email }, bRow }
    );

    // 許可リストの見直し：1時間たつと見直し、外されていれば締め出す（載っていれば通す・開発用ログインは見ない）
    const old = Date.now() - 2 * 60 * 60 * 1000;
    const notAllowed = await jwt({ token: { userId: victim.id, allowCheckedAt: old } } as never);
    const admin = await db.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } });
    const allowed = await jwt({ token: { userId: admin!.id, allowCheckedAt: old } } as never);
    const fresh = await jwt({ token: { userId: victim.id, allowCheckedAt: Date.now() - 60 * 1000 } } as never);
    const dev = await jwt({ token: { userId: victim.id, allowCheckedAt: old, devLogin: true } } as never);
    const session = await authOptions.callbacks!.session!({ session: { user: { email: "x" }, expires: "" }, token: notAllowed } as never);
    check(
      "F282",
      "許可リストから外された人は1時間ごとの見直しで締め出される（載っている人・見直し前・開発用ログインは通す）",
      notAllowed.revoked === true &&
        (notAllowed.allowCheckedAt as number) > old &&
        !allowed.revoked &&
        !fresh.revoked &&
        !dev.revoked &&
        (session as { user?: unknown }).user === undefined &&
        (await isStillAllowed(admin!.id)) &&
        !(await isStillAllowed(victim.id)),
      { notAllowed: notAllowed.revoked, allowed: allowed.revoked, fresh: fresh.revoked, dev: dev.revoked, session }
    );
  } catch (e) {
    check("F279x", "ログインの照合の確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.allowlistEntry.deleteMany({ where: { email: allowMail } });
    await db.user.deleteMany({ where: { OR: [{ discordUserId: { in: [...ids, "198000000000000009"] } }, { email: { in: [victimMail, freeMail, allowMail] } }] } });
  }
}

// ── cron の合言葉は「未設定なら誰も通さない」（フェイルクローズ） ──
// 総合テストのサーバーは CRON_SECRET を設定して起動するので、未設定の側はここでしか見られない
{
  const saved = process.env.CRON_SECRET;
  const req = (auth?: string) => new Request("http://localhost/api/cron/check-bot-health", { headers: auth ? { authorization: auth } : {} });
  try {
    delete process.env.CRON_SECRET;
    const unset = { undef: isCronRequest(req("Bearer undefined")), bare: isCronRequest(req("Bearer ")), none: isCronRequest(req()) };
    process.env.CRON_SECRET = "";
    const empty = { bare: isCronRequest(req("Bearer ")), undef: isCronRequest(req("Bearer undefined")) };
    process.env.CRON_SECRET = "s3cret";
    const set = { ok: isCronRequest(req("Bearer s3cret")), wrong: isCronRequest(req("Bearer s3creT")), longer: isCronRequest(req("Bearer s3cret!")), none: isCronRequest(req()) };
    check(
      "F286",
      "CRON_SECRET が未設定・空なら cron を誰も呼べない（「Bearer undefined」でも通らない）。設定時は一致したときだけ通る",
      !unset.undef && !unset.bare && !unset.none && !empty.bare && !empty.undef && set.ok && !set.wrong && !set.longer && !set.none,
      { unset, empty, set }
    );
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
}

// ── DBの例外を画面へ返すとき、中身（接続先・クエリ）を出さない ──
// 想定外の例外は本番でしか起きないので、HTTPからは狙って起こせない
{
  const raw = new Error(
    "\nInvalid `prisma.groupInvite.create()` invocation:\n\n\nCan't reach database server at `db.abcdefgh.supabase.co:5432`"
  );
  const generic = describeDbError(raw);
  const known = describeDbError(Object.assign(new Error("Unique constraint failed on the fields: (`token`)"), { code: "P2002" }));
  check(
    "F288",
    "想定外のDBの例外は決まった文言だけを返し、接続先やクエリを含めない（既知のコードは今までどおり理由を返す）",
    !/supabase|5432|prisma|invocation/i.test(generic) && generic.length > 0 && known === "同じ内容が既に登録されています。",
    { generic, known }
  );
}

// ── ログインの失敗の記録は、外から作れる文をそのまま残さない ──
// コールバックの `?error_description=` に書いた文はそのまま例外のメッセージになる。
// 文や端末でまとめるキーが増えると、適当なURLを叩くだけで通知チャンネルを埋められる
{
  const crafted = (d: string) =>
    classifyAuthError("OAUTH_CALLBACK_ERROR", { error: { name: "OPError", message: `weird (${d})` }, providerId: "discord" });
  const a = crafted("<b>@everyone</b> 見てね https://evil.example/");
  const b = crafted("別の文");
  const state = classifyAuthError("OAUTH_CALLBACK_ERROR", { error: { name: "OAuthCallbackError", message: "State cookie was missing." } });
  const fromClient = classifyAuthError("CLIENT_FETCH_ERROR", { message: "x", client: true });
  const clientOauth = classifyAuthError("OAUTH_CALLBACK_ERROR", { message: "x", client: true });
  check(
    "F291",
    "ログインの失敗の記録は、外から作れる文を英数字だけに削り、まとめるキーは分類だけで作る（ブラウザからの報告は記録しない）",
    !!a && !!b && a.fingerprint === b.fingerprint && !/[<>@\/]/.test(a.message) && !a.message.includes("見てね") &&
      state?.fingerprint === "auth:OAUTH_CALLBACK_ERROR:state-missing" && fromClient === null && clientOauth === null,
    { a, b, state, fromClient, clientOauth }
  );
}

await db.$disconnect();
console.log(JSON.stringify(rows));
