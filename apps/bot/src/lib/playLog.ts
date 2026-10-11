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
 * VCごと・ゲームごとに、対象者のうち誰が遊んでいるかをまとめる。**2人以上の組だけ**を返す。
 *
 * - 対象者（`eligible`）に入っていない人は数えない。Webへも送らない（アプリに同意していない人の
 *   情報を持たないため）
 * - 1人が同時に複数の「プレイ中」を持つことはまず無いが、あればそれぞれに数える
 * - 結果は並びを固定する（前回と同じかを文字列で比べるため）
 */
export function computePlayingGroups(
  voice: VoiceMember[],
  activitiesOf: (userId: string) => ActivityLike[],
  eligible: Set<string>
): PlayingGroup[] {
  const groups = new Map<string, PlayingGroup>();

  for (const v of voice) {
    if (!eligible.has(v.userId)) continue;
    for (const a of activitiesOf(v.userId)) {
      if (a.type !== ACTIVITY_PLAYING || !a.name) continue;
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

  return [...groups.values()]
    .filter((g) => g.participants.length >= 2)
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
