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
import { getGamePlaySummary, getGroupPlayTotals, getPlayCalendar } from "../../apps/web/src/lib/playLog";
import { getRecentActivity, mergeTimeline, playTimelineEntries } from "../../apps/web/src/lib/activityFeed";

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

// ── グループ画面の帯とゲーム一覧の時間（docs/play-log.md §13） ──
// 数え方を直接確かめる。画面の表示は flows（F297）とブラウザ（B113）で見る
{
  const owner = await db.user.findFirst({ where: { email: "admin@example.com" }, select: { id: true } });
  const group = await db.group.create({ data: { name: `帯の集計テスト-${randomUUID().slice(0, 6)}`, ownerId: owner!.id } });
  try {
    const mkGame = (title: string, steamAppId: number) =>
      db.groupGame.create({ data: { groupId: group.id, title, steamAppId, status: "PLAYING", addedById: owner!.id } });
    const [a, b, c, d] = await Promise.all([mkGame("重なりのあるゲーム", 9100001), mkGame("1回だけのゲーム", 9100002), mkGame("同じ時間のゲーム", 9100003), mkGame("30秒のゲーム", 9100004)]);
    const base = Date.now() - 3 * 86400000;
    const at = (min: number) => new Date(base + min * 60000);
    const mk = (groupGameId: string | null, from: number, to: number, key: string) =>
      db.groupPlaySession.create({
        data: { groupId: group.id, groupGameId, gameKey: key, activityName: key, voiceChannelId: "vc-total", startedAt: at(from), endedAt: at(to) },
      });
    // A: 0〜60分と30〜90分（別々のVC。重なりは1回だけ数えて90分）。B: 45分。未結びつき: 60分（数えない）
    await mk(a.id, 0, 60, "name:a1");
    await mk(a.id, 30, 90, "name:a2");
    await mk(b.id, 200, 245, "name:b");
    await mk(null, 300, 360, "name:unknown");
    await mk(d.id, 400, 400.5, "name:d"); // 30秒（1分未満は数えない）
    const first = await getGroupPlayTotals(group.id);
    const detailA = await getGamePlaySummary(a.id);
    // C: A と同じ90分で、後に遊んだ → いちばん遊んだゲームは C になる
    await mk(c.id, 500, 590, "name:c");
    const second = await getGroupPlayTotals(group.id);
    const empty = await getGroupPlayTotals(randomUUID());
    const min = 60000;
    check(
      "F298",
      "グループの合計は各ゲームの和（同じゲームの重なりは1回・未結びつきと1分未満は数えない）で、ゲーム詳細の合計と一致し、いちばん遊んだゲームは同じ時間なら後に遊んだ方",
      first.byGame[a.id] === 90 * min && first.byGame[b.id] === 45 * min && first.byGame[d.id] === undefined &&
        first.totalMs === 135 * min && first.gameCount === 2 && first.topGameId === a.id &&
        detailA.totalMs === first.byGame[a.id] &&
        second.totalMs === 225 * min && second.gameCount === 3 && second.topGameId === c.id &&
        second.lastPlayedAt === at(590).toISOString() &&
        empty.totalMs === 0 && empty.topGameId === null && empty.lastPlayedAt === null,
      { first, detailA: detailA.totalMs, second: { totalMs: second.totalMs, gameCount: second.gameCount, top: second.topGameId, last: second.lastPlayedAt }, empty }
    );
  } catch (e) {
    check("F298x", "帯の集計の確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.group.delete({ where: { id: group.id } }).catch(() => {});
  }
}

// ── 活動カレンダーのプレイ記録（docs/play-log.md §11 の段階1） ──
// 数え方を直接確かめる。画面に出るかは flows（F300）で見る
{
  const owner = await db.user.findFirst({ where: { email: "admin@example.com" }, select: { id: true, name: true } });
  const nameless = await db.user.create({ data: { email: `cal-nameless-${randomUUID().slice(0, 6)}@example.com`, name: null } });
  const group = await db.group.create({ data: { name: `カレンダーのプレイ-${randomUUID().slice(0, 6)}`, ownerId: owner!.id } });
  try {
    const game = await db.groupGame.create({ data: { groupId: group.id, title: "夜ふかしのゲーム", steamAppId: 9100011, status: "PLAYING", addedById: owner!.id } });
    // 10日前のJSTの0時。日付はJSTで切る
    const jstMidnight = new Date(`${new Date(Date.now() + 9 * 3600000 - 10 * 86400000).toISOString().slice(0, 10)}T00:00:00.000+09:00`);
    const at = (min: number) => new Date(jstMidnight.getTime() + min * 60000);
    const dayOf = (min: number) => new Date(at(min).getTime() + 9 * 3600000).toISOString().slice(0, 10);
    const mk = (groupGameId: string | null, from: number, to: number, key: string, userIds: string[] = []) =>
      db.groupPlaySession.create({
        data: {
          groupId: group.id, groupGameId, gameKey: key, activityName: key.replace("name:", ""), voiceChannelId: `vc-${key}`,
          startedAt: at(from), endedAt: at(to),
          participants: { create: userIds.map((userId) => ({ userId, joinedAt: at(from), leftAt: at(to) })) },
        },
      });
    // 23:30〜翌1:00（日付をまたぐ。始まった日に90分）と、別のVCで23:45〜翌0:45（重なりは1回だけ数える）
    await mk(game.id, 23 * 60 + 30, 25 * 60, "name:night-a", [owner!.id, nameless.id]);
    await mk(game.id, 23 * 60 + 45, 24 * 60 + 45, "name:night-b");
    // 翌日 20:00〜20:40 の結びついていない回（名前のまま載る）と、21:00〜21:03 の3分（出さない）
    await mk(null, 44 * 60, 44 * 60 + 40, "name:名前だけのゲーム");
    await mk(game.id, 45 * 60, 45 * 60 + 3, "name:short");
    // 前日 23:00 に始まった回（期間の前に始まったので入らない）
    await mk(game.id, -60, 120, "name:before");

    const cal = await getPlayCalendar(group.id, { start: at(0), end: at(48 * 60) });
    const d0 = dayOf(0);
    const d1 = dayOf(24 * 60);
    const night = cal.entries.find((e) => e.participants.length === 2);
    const rows2 = playTimelineEntries(group.id, cal.entries);
    const merged = mergeTimeline(
      [{ id: "ev", kind: "photo.created", emoji: "📷", label: "写真を投稿", occurredAt: at(24 * 60 + 10), createdAt: at(0), actorName: null, targetName: null, note: null, href: null }],
      rows2
    );
    const min = 60000;
    check(
      "F299",
      "カレンダーのプレイ記録は始まった日（JST）にまとめ、同じゲームの重なりを1回だけ数え、5分未満と期間の前に始まった回は出さず、表示名の無い人をメールで出さない",
      Object.keys(cal.days).sort().join(",") === [d0, d1].join(",") &&
        cal.days[d0].totalMs === 90 * min && cal.days[d0].sessionCount === 2 &&
        cal.days[d1].totalMs === 40 * min && cal.days[d1].sessionCount === 1 &&
        cal.entries.length === 3 && cal.entries[0].title === "名前だけのゲーム" && cal.entries[0].groupGameId === null &&
        night?.participants.includes("メンバー") === true && !night.participants.some((p) => p.includes("@")) &&
        rows2.some((r) => r.label === "夜ふかしのゲーム を 1時間30分" && r.href === `/groups/${group.id}/games/${game.id}`) &&
        rows2[0].href === null &&
        merged.map((r) => r.id).join(",") === [rows2[0].id, "ev", rows2[1].id, rows2[2].id].join(","),
      { days: cal.days, entries: cal.entries.map((e) => [e.title, e.durationMs / min, e.participants]), merged: merged.map((r) => r.label) }
    );
  } catch (e) {
    check("F299x", "カレンダーのプレイ記録の確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.group.delete({ where: { id: group.id } }).catch(() => {});
    await db.user.delete({ where: { id: nameless.id } }).catch(() => {});
  }
}

// ── グループ画面の「最近の動き」（docs/play-log.md §11 の段階2） ──
// 画面に出るかは flows（F302）とブラウザ（B115）で見る
{
  const owner = await db.user.findFirst({ where: { email: "admin@example.com" }, select: { id: true, name: true } });
  const nameless = await db.user.create({ data: { email: `recent-nameless-${randomUUID().slice(0, 6)}@example.com`, name: null } });
  const group = await db.group.create({ data: { name: `最近の動き-${randomUUID().slice(0, 6)}`, ownerId: owner!.id } });
  try {
    const game = await db.groupGame.create({ data: { groupId: group.id, title: "最近のゲーム", steamAppId: 9100021, status: "PLAYING", addedById: owner!.id } });
    // 「今日」のJSTの12:00を now にする（日付の見出しと日またぎを決め打ちで確かめるため）
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const now = new Date(`${today}T12:00:00.000+09:00`);
    const at = (hm: string, dayOffset = 0) => new Date(new Date(`${today}T${hm}:00.000+09:00`).getTime() + dayOffset * 86400000);
    const log = (kind: string, actorId: string, createdAt: Date, targetName: string | null = null, occurredAt = createdAt) =>
      db.activityLog.create({ data: { kind, targetId: randomUUID(), targetName, groupId: group.id, actorId, createdAt, occurredAt } });
    // 新しい順に:
    await log("photo.created", owner!.id, at("11:50"), "G1", new Date(now.getTime() - 365 * 86400000)); // 撮ったのは1年前、上げたのは今日
    await log("photo.created", owner!.id, at("11:49"), "G1");
    await log("photo.created", owner!.id, at("11:48"), "G1"); // ここまで同じ人の続けての投稿 → 「写真を3枚投稿」
    await log("photo.deleted", owner!.id, at("11:46")); // 取り消し系は出さない（まとめも切らない）
    await log("album.deleted", owner!.id, at("11:46"), "消したアルバム"); // 削除系も出さない
    await log("game.removed", owner!.id, at("11:46"), "消したゲーム");
    await log("game.interest_removed", owner!.id, at("11:46"), "外したゲーム");
    await log("photo.created", owner!.id, at("11:45"), "G1"); // → 4枚目としてまとまる
    await log("photo.created", nameless.id, at("11:44"), "G2"); // 別の人 → 別の行。表示名が無いので「メンバー」
    await log("game.added", owner!.id, at("11:30"), "最近のゲーム"); // ➕
    await db.groupPlaySession.create({
      data: {
        groupId: group.id, groupGameId: game.id, gameKey: "name:recent", activityName: "recent", voiceChannelId: "vc-recent",
        startedAt: at("11:00"), endedAt: at("11:30"),
        participants: { create: [owner!.id, nameless.id].map((userId) => ({ userId, joinedAt: at("11:00"), leftAt: at("11:30") })) },
      },
    });
    await log("photo.created", owner!.id, at("10:50"), "G1"); // 間に別の行が挟まった → まとめない
    await log("album.created", nameless.id, at("05:00"), "アルバム");
    await log("photo.created", owner!.id, at("00:01"), "G1");
    await log("photo.created", owner!.id, at("23:59", -1), "G1"); // 日をまたいだ → まとめない（「昨日」の見出しの下）

    const five = await getRecentActivity(group.id, 5, now);
    const all = await getRecentActivity(group.id, 20, now);
    const flat = (days: Awaited<ReturnType<typeof getRecentActivity>>) => days.flatMap((d) => d.entries);
    const f5 = flat(five);
    const fa = flat(all);
    check(
      "F301",
      "最近の動きは記録した時刻の新しい順に5件で、同じ人の続けての写真を1行にまとめ（間に挟まる・日をまたぐと切る）、取り消し・削除系と表示名の無い人のメールを出さず、ゲームの追加は➕・遊んだ記録は🎮",
      f5.length === 5 &&
        f5[0].label === "写真を4枚投稿" && f5[0].targetName === "G1" &&
        f5[1].label === "写真を投稿" && f5[1].actorName === "メンバー" &&
        f5[2].kind === "game.added" && f5[2].emoji === "➕" &&
        f5[3].kind === "play.session" && f5[3].emoji === "🎮" && f5[3].label === "最近のゲーム を 30分" && f5[3].actorName?.includes("メンバー") === true &&
        f5[4].label === "写真を投稿" &&
        five.length === 1 && five[0].label === "今日" &&
        !fa.some((e) => ["photo.deleted", "album.deleted", "game.removed", "game.interest_removed"].includes(e.kind)) &&
        !fa.some((e) => (e.actorName ?? "").includes("@")) &&
        fa.length === 8 && all.map((d) => d.label).join(",") === "今日,昨日" && all[1].entries.length === 1,
      { five: five.map((d) => [d.label, d.entries.map((e) => `${e.emoji}${e.label}/${e.actorName}`)]), all: all.map((d) => [d.label, d.entries.length]) }
    );
  } catch (e) {
    check("F301x", "最近の動きの確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.activityLog.deleteMany({ where: { groupId: group.id } }).catch(() => {});
    await db.group.delete({ where: { id: group.id } }).catch(() => {});
    await db.user.delete({ where: { id: nameless.id } }).catch(() => {});
  }
}

// ── 「ゲーム提案」→「ウィッシュリスト」の言い方（2026-10-18 ユーザー判断） ──
// グループ画面の「最近の動き」に出る行の文言。投票・採用（「提案に投票」「提案が通った」）は仕組みの言い方なのでそのまま
{
  const owner = await db.user.findFirst({ where: { email: "admin@example.com" }, select: { id: true } });
  const group = await db.group.create({ data: { name: `ウィッシュリスト-${randomUUID().slice(0, 6)}`, ownerId: owner!.id } });
  try {
    await db.activityLog.create({ data: { kind: "proposal.created", targetId: randomUUID(), targetName: "候補のゲーム", groupId: group.id, actorId: owner!.id, occurredAt: new Date() } });
    const entry = (await getRecentActivity(group.id)).flatMap((d) => d.entries)[0];
    check("F303", "ウィッシュリストに入れた出来事は「ウィッシュリストに追加」と出る（「ゲームを提案」ではない）", entry?.label === "ウィッシュリストに追加" && entry?.emoji === "💡", { label: entry?.label, emoji: entry?.emoji });
  } catch (e) {
    check("F303x", "ウィッシュリストの言い方の確認が途中で例外になった（以降は未確認）", false, (e as Error)?.stack ?? e);
  } finally {
    await db.activityLog.deleteMany({ where: { groupId: group.id } }).catch(() => {});
    await db.group.delete({ where: { id: group.id } }).catch(() => {});
  }
}

await db.$disconnect();
console.log(JSON.stringify(rows));
