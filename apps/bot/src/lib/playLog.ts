/**
 * プレイ記録の検知（グループとして一緒に遊んだ時間）。設計は docs/play-log.md。
 *
 * **ここはDiscordに触らない純粋関数だけを置く。** CIからDiscordには繋がらないので、
 * 「VCの状態＋プレイ状況＋対象者 → 遊んでいる組」をここに切り出して単体で確かめる
 * （tools/local-test/flows.mjs が apps/bot/dist から読む）。
 */

/** discord.js の ActivityType.Playing。Spotify・カスタムステータス・配信などは数えない */
export const ACTIVITY_PLAYING = 0;

export type VoiceMember = { userId: string; channelId: string };

export type ActivityLike = {
  type: number;
  name: string;
  applicationId: string | null;
  /** Discordのアクティビティが持つ開始時刻（エポックミリ秒）。無いこともある */
  startedAt: number | null;
};

export type PlayingGroup = {
  voiceChannelId: string;
  applicationId: string | null;
  name: string;
  participants: { discordUserId: string; since: number | null }[];
};

/** 同じゲームかどうかの判定。アプリIDがあればそれ、無ければ名前（大文字小文字・空白の差は無視） */
export function activityKey(a: { applicationId: string | null; name: string }): string {
  return a.applicationId ? `app:${a.applicationId}` : `name:${a.name.normalize("NFKC").toLowerCase().replace(/\s+/g, "")}`;
}

/**
 * VCごと・ゲームごとに、対象者のうち誰が遊んでいるかをまとめる。**`minParticipants` 人以上の組だけ**を返す
 * （既定2人。管理者が1人用のテストグループで動きを確かめるときだけ1人。Webの members API から来る）。
 *
 * - **プレイ中が見えない対象者も、そのVCで見えているゲームが1つだけならその組に数える**
 *   （2026-10-11 ユーザー判断）。Discordで「オンライン状態を隠す」にしている人は、Botからは
 *   オフライン・プレイ中なしにしか見えない。グループの4人中3人がこの設定で、最初に遊んだ回は
 *   見えるのが1人だけになり記録が0件だった。代わりに、VCで雑談しているだけの人も数える。
 *   見えているゲームが2つ以上のVCでは、どれに入れるか決められないので数えない
 * - 対象者（`eligible`）に入っていない人は数えない。Webへも送らない（アプリに同意していない人の
 *   情報を持たないため）
 * - 1人が同時に複数の「プレイ中」を持つことはまず無いが、あればそれぞれに数える
 * - 結果は並びを固定する（前回と同じかを文字列で比べるため）
 */
export function computePlayingGroups(
  voice: VoiceMember[],
  activitiesOf: (userId: string) => ActivityLike[],
  eligible: Set<string>,
  minParticipants = 2
): PlayingGroup[] {
  const groups = new Map<string, PlayingGroup>();
  const silentByChannel = new Map<string, string[]>();

  for (const v of voice) {
    if (!eligible.has(v.userId)) continue;
    const playing = activitiesOf(v.userId).filter((a) => a.type === ACTIVITY_PLAYING && a.name);
    if (playing.length === 0) {
      silentByChannel.set(v.channelId, [...(silentByChannel.get(v.channelId) ?? []), v.userId]);
      continue;
    }
    for (const a of playing) {
      const key = `${v.channelId}\u0000${activityKey(a)}`;
      let g = groups.get(key);
      if (!g) {
        g = { voiceChannelId: v.channelId, applicationId: a.applicationId, name: a.name, participants: [] };
        groups.set(key, g);
      }
      if (!g.participants.some((p) => p.discordUserId === v.userId)) {
        g.participants.push({ discordUserId: v.userId, since: a.startedAt });
      }
    }
  }

  for (const [channelId, silent] of silentByChannel) {
    const inChannel = [...groups.values()].filter((g) => g.voiceChannelId === channelId);
    if (inChannel.length !== 1) continue;
    for (const userId of silent) inChannel[0].participants.push({ discordUserId: userId, since: null });
  }

  return [...groups.values()]
    .filter((g) => g.participants.length >= minParticipants)
    .map((g) => ({
      ...g,
      participants: [...g.participants].sort((a, b) => a.discordUserId.localeCompare(b.discordUserId)),
    }))
    .sort((a, b) =>
      a.voiceChannelId === b.voiceChannelId
        ? activityKey(a).localeCompare(activityKey(b))
        : a.voiceChannelId.localeCompare(b.voiceChannelId)
    );
}

/**
 * 送り直すべき変化か。**`since` は比べない**——同じプレイのまま値だけ揺れることがあり、
 * それで送り直すとAPIを無駄に叩く。人の出入りとゲームの変化だけを見る。
 */
export function snapshotSignature(groups: PlayingGroup[]): string {
  return JSON.stringify(
    groups.map((g) => [g.voiceChannelId, activityKey(g), g.participants.map((p) => p.discordUserId)])
  );
}

// ── `/playlog status` の診断表示 ──────────────────────────────
//
// 4人で遊んだのに記録が0件だったとき、原因の候補（プレイ中がBotに届いていない／同じゲームが
// 別扱いになって1人ずつに分かれた／送ったがWebに弾かれた）を外から区別できなかった。
// 成功は何もログに残らない作りだったため。遊んでいる最中に打てば、Botから見えている状態を
// そのまま本人に返す。**ここは文字を組み立てるだけ**（Discordに触らない）。

export type StatusMember = {
  userId: string;
  /** 対象者か。対象外の人のプレイ状況は表示しない（同意していない人の情報を出さないため） */
  eligible: boolean;
  activities: ActivityLike[];
};

export type PlayStatusView = {
  now: number;
  /** 起動処理（進行中の記録を閉じる）が済んでいるか。済むまでは送らない */
  ready: boolean;
  /** 対象者の一覧。null＝まだ一度も取れていない */
  eligibleCount: number | null;
  /** 記録の最少人数（既定2。テスト用に1のことがある） */
  minParticipants: number;
  membersFetchedAt: number | null;
  /** 打った人がいるVC。null＝VCにいない */
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  inVoice: StatusMember[];
  lastSend: { at: number; ok: boolean; groups: number; reason?: string } | null;
};

const mention = (id: string) => `<@${id}>`;
const ago = (now: number, at: number) => {
  const min = Math.max(0, Math.round((now - at) / 60000));
  return min === 0 ? "1分以内" : `${min}分前`;
};
const nameKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function describePlayStatus(v: PlayStatusView): string {
  const lines: string[] = ["**いまBotから見えている様子**"];

  if (!v.ready) lines.push("・Botの起動処理がまだ終わっていません（終わるまでは送りません）");
  if (v.eligibleCount === null || v.membersFetchedAt === null) {
    lines.push("・対象者の一覧をWebから取れていません（Webに繋がっていない可能性があります）");
  } else {
    lines.push(
      `・このサーバーの対象者：${v.eligibleCount}人（${ago(v.now, v.membersFetchedAt)}に取得）` +
        (v.minParticipants !== 2 ? `・**記録の最少人数：${v.minParticipants}人（動作確認用）**` : "")
    );
  }

  if (v.voiceChannelId === null) {
    lines.push("・あなたはいまVCに入っていません。VCで遊んでいる最中に打つと、一緒にいる人の見え方が出ます");
  } else {
    lines.push(`・VC「${v.voiceChannelName ?? v.voiceChannelId}」にいる人：`);
    for (const m of v.inVoice) {
      if (!m.eligible) {
        lines.push(`　${mention(m.userId)}：対象外（連携していない・グループのメンバーでない・外れている、のどれか）`);
        continue;
      }
      const playing = m.activities.filter((a) => a.type === ACTIVITY_PLAYING && a.name);
      lines.push(
        playing.length === 0
          ? `　${mention(m.userId)}：**プレイ中が届いていません**（VCで見えているゲームが1つだけなら、その組に数えます）`
          : `　${mention(m.userId)}：${playing.map((a) => `${a.name}（アプリID${a.applicationId ? "あり" : "なし"}）`).join("、")}`
      );
    }

    const eligible = new Set(v.inVoice.filter((m) => m.eligible).map((m) => m.userId));
    const byId = new Map(v.inVoice.map((m) => [m.userId, m.activities]));
    const groups = computePlayingGroups(
      v.inVoice.map((m) => ({ userId: m.userId, channelId: v.voiceChannelId as string })),
      (id) => byId.get(id) ?? [],
      eligible,
      v.minParticipants
    );
    lines.push(
      groups.length > 0
        ? `→ いま記録される組：${groups.map((g) => `${g.name}（${g.participants.length}人）`).join("、")}`
        : `→ いまは記録の条件（同じVCに対象者${v.minParticipants}人以上・うち誰かのプレイ中が見えていて、ゲームが1つに決まる）を満たしていません`
    );

    // 候補1：本人には見えていても、Discordの設定でBotに届かないことがある
    const silent = v.inVoice.filter(
      (m) => m.eligible && !m.activities.some((a) => a.type === ACTIVITY_PLAYING && a.name)
    );
    if (silent.length > 0) {
      lines.push(
        "※ プレイ中が届かない主な原因は、ステータスを「オンライン状態を隠す」にしていること、または" +
          "「設定 → アクティビティのプライバシー」でアクティビティの共有がオフになっていること。" +
          "どちらも本人の画面には出ていてもBotには届きません"
      );
    }

    // 候補2：同じ名前なのにアプリIDが違う（有無を含む）と、別のゲームとして数えて組が割れる
    const keysByName = new Map<string, Set<string>>();
    for (const m of v.inVoice) {
      if (!m.eligible) continue;
      for (const a of m.activities) {
        if (a.type !== ACTIVITY_PLAYING || !a.name) continue;
        const set = keysByName.get(nameKey(a.name)) ?? new Set<string>();
        set.add(activityKey(a));
        keysByName.set(nameKey(a.name), set);
      }
    }
    if ([...keysByName.values()].some((s) => s.size > 1)) {
      lines.push("※ 同じゲーム名なのに、アプリIDが人によって違う（付いている人と付いていない人がいる）ため、別のゲームとして数えています");
    }
  }

  // 候補3：送ったが弾かれた
  if (v.lastSend === null) {
    lines.push("・Webへの送信：起動してからまだ一度もしていません");
  } else if (v.lastSend.ok) {
    lines.push(`・最後の送信：${ago(v.now, v.lastSend.at)}・成功（記録中の組 ${v.lastSend.groups}）`);
  } else {
    lines.push(`・最後の送信：${ago(v.now, v.lastSend.at)}・**失敗**（${v.lastSend.reason ?? "理由不明"}）`);
  }

  return lines.join("\n");
}
