import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyFinishedPlays } from "@/lib/playLogNotify";

/**
 * 前回の生存報告がこれより新しいときだけ、プレイ記録の終了の通知を送る（Botは15分おき）。
 * 長く落ちていた後の最初の報告では送らない——Botが落ちている間に閉じた行は、この直後の
 * 起動処理で「続き」としてつなぎ直されうるので、先に「終わった」を出すと嘘になる。
 */
const CONTINUOUS_MS = 20 * 60 * 1000;

/**
 * Discord Bot（apps/bot、PM2常駐プロセス）が起動時＋定期的に叩く生存報告用の内部API。
 * リクエストヘッダの共有シークレットで認証する（一般ユーザーからは叩けない）。
 *
 * POST /api/internal/bot-heartbeat
 *
 * **更新する前の時刻を `previousSeenAt` として返す。** Botはこれを
 * 「自分が最後に生きていた時刻」として使い、落ちていた間の投稿を遡って取り込む
 * （`apps/bot/src/lib/catchUp.ts`）。専用のテーブルも列も足していないのは、
 * ここに既に「最後に生きていた時刻」そのものがあるため。
 *
 * 初回（行が無い）は `null` を返す。**その場合Botは遡らない**——
 * どこまで戻ればよいか分からないまま履歴を漁ることになるので。
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const previous = await db.botHeartbeat.findUnique({
    where: { id: "bot" },
    select: { lastSeenAt: true },
  });

  await db.botHeartbeat.upsert({
    where: { id: "bot" },
    update: { lastSeenAt: new Date() },
    create: { id: "bot", lastSeenAt: new Date() },
  });

  // 遊び終わってから次のスナップショットが来ないことは普通にある（変化が無ければBotは送らない）。
  // 終了の通知（閉じて10分後）を拾うのは、定期的に必ず来るこの報告
  if (previous && Date.now() - previous.lastSeenAt.getTime() < CONTINUOUS_MS) {
    await notifyFinishedPlays().catch((err) => console.error("[playlog] 終了の通知の処理に失敗", err));
  }

  return NextResponse.json({
    ok: true,
    previousSeenAt: previous?.lastSeenAt.toISOString() ?? null,
  });
}
