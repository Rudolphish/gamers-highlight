import { db } from "./db";
import { postDiscordMessage } from "./discord";
import { getNotificationChannel } from "./notificationTargets";
import { MERGE_GAP_MS } from "./playLog";
import { formatPlayDuration } from "./playDuration";

// プレイ記録の開始・終了をグループの通知チャンネル（種類 PLAY_LOG）へ送る。設計は docs/play-log.md。
//
// - **開始**は行を作った瞬間に送る。つなぎ直し（10分以内に戻った・Botの再起動）では送らない
// - **終了**は、Botが「プレイが止まった」を見て閉じた行なら**すぐ**送る（2026-11-02 ユーザー判断）。
//   以前は閉じてから10分戻らなかったものだけ送っていたが、遊び終わってすぐBotのPCを落とすと
//   その10分の間にBotが止まり、終了が届かなかった（11/2 の回。最後の生存報告まで54秒足りなかった）。
//   代わりに、誰かが一瞬落ちて10分以内に戻った回は「終わった」が2回出る（行は1つのまま。ユーザーが選んだ）
// - **推定で閉じた行**（Botが落ちていた間に終わったものとして起動時に閉じた行）は、閉じてから10分待つ。
//   直後のスナップショットで「続き」としてつなぎ直されうるので、先に「終わった」を出すと嘘になる
// - 送れていない終了は、次にBotが動いたとき（生存報告・スナップショットのついで）に送る。遊んだ時間から
//   遅れて送るときは「いつ遊んだ分か」を添える
//
// どちらも**送れなくても記録は止めない**（`postDiscordMessage` は例外を投げず false を返す）。

/**
 * これより前に終わった行は通知しない。長く送れなかった行をまとめて流さないため。
 * 遊び終わってすぐBotのPCを落とし、次に点けるのが翌日になっても届くよう2日にしてある（以前は6時間）
 */
const END_NOTIFY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** 終わってからこれより後に送るときは、いつ遊んだ分かを添える */
const LATE_NOTICE_MS = 30 * 60 * 1000;

/** 「11/2 22:12〜0:59」。日本時間で出す（Vercel のサーバーは UTC） */
function jstRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} ${time(start)}〜${time(end)}`;
}

type SessionForNotify = {
  activityName: string;
  groupGame: { title: string } | null;
  participants: { user: { name: string | null } }[];
};

const sessionInclude = {
  groupGame: { select: { title: true } },
  participants: { select: { user: { select: { name: true } } }, orderBy: { joinedAt: "asc" as const } },
};

function titleOf(s: SessionForNotify) {
  return s.groupGame?.title ?? s.activityName;
}

// 表示名が無くてもメールアドレスにはフォールバックしない（Discordにメールアドレスを流さない。提案の通知と同じ）
function membersOf(s: SessionForNotify) {
  return s.participants.map((p) => p.user.name ?? "メンバー").join("、");
}

// 表記は lib/playDuration.ts に1つだけ置いている（ここから使っている呼び出し側のために名前を残す）
export { formatPlayDuration };

/** 行を作った直後に呼ぶ。送り先が無ければ何もしない */
export async function notifyPlayStarted(sessionId: string): Promise<void> {
  const session = await db.groupPlaySession.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!session) return;
  const channelId = await getNotificationChannel(session.groupId, "PLAY_LOG");
  if (!channelId) return;

  const ok = await postDiscordMessage(
    channelId,
    [`🎮 **${titleOf(session)}** の記録を始めました`, `参加: ${membersOf(session)}`].join("\n")
  );
  if (!ok) console.error(`[playlog] 開始の通知に失敗しました sessionId=${sessionId} channelId=${channelId}`);
}

/**
 * 閉じた行の終了を送る。何度呼んでもよい（送った行には印を付ける）。
 * Botが閉じた行はすぐ、推定で閉じた行は閉じてから10分たってから（上のコメント）。
 *
 * 同時に2回呼ばれても二重に送らないよう、**先に印を付けてから送る**（付けられた方だけが送る）。
 * 送れなかったら印を外して、次の呼び出しで送り直す。送り先が無いグループの行は印だけ付ける。
 */
export async function notifyFinishedPlays(now = new Date()) {
  const candidates = await db.groupPlaySession.findMany({
    where: {
      endNotifiedAt: null,
      endedAt: { lte: now, gte: new Date(now.getTime() - END_NOTIFY_WINDOW_MS) },
      // 推定の行は、終わりの時刻（＝Botが最後に生きていた時刻）ではなく**閉じた時刻**から10分待つ。
      // 終わりの時刻は落ちていた分だけ昔なので、そちらで見ると起動した瞬間に送ってしまう
      OR: [{ estimated: false }, { updatedAt: { lte: new Date(now.getTime() - MERGE_GAP_MS) } }],
    },
    include: sessionInclude,
    orderBy: { endedAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const channels = new Map<string, string | null>();
  for (const s of candidates) {
    const claimed = await db.groupPlaySession.updateMany({
      where: { id: s.id, endNotifiedAt: null, endedAt: { not: null } },
      data: { endNotifiedAt: now },
    });
    if (claimed.count === 0) continue;

    if (!channels.has(s.groupId)) channels.set(s.groupId, await getNotificationChannel(s.groupId, "PLAY_LOG"));
    const channelId = channels.get(s.groupId);
    if (!channelId) {
      skipped++;
      continue;
    }

    const lines = [
      `🏁 **${titleOf(s)}** を ${formatPlayDuration(s.endedAt!.getTime() - s.startedAt.getTime())} 遊びました`,
      `参加: ${membersOf(s)}`,
    ];
    if (s.estimated) lines.push("（Botが止まっていたため、終わりの時刻は推定です）");
    if (now.getTime() - s.endedAt!.getTime() > LATE_NOTICE_MS) {
      lines.push(`（${jstRange(s.startedAt, s.endedAt!)} に遊んだ分です。Botが止まっていたため遅れて送りました）`);
    }

    if (await postDiscordMessage(channelId, lines.join("\n"))) {
      sent++;
    } else {
      failed++;
      console.error(`[playlog] 終了の通知に失敗しました sessionId=${s.id} channelId=${channelId}`);
      await db.groupPlaySession.updateMany({ where: { id: s.id }, data: { endNotifiedAt: null } });
    }
  }
  return { sent, failed, skipped };
}
