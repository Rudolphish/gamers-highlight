import { postDiscordMessage } from "./discord";
import { APP_SETTING_KEYS, getAppSetting, setAppSetting } from "./appSettings";
import { getStorageStats, getDatabaseStats, formatBytes } from "./adminStats";

/**
 * 無料枠を超えないための見張り。
 *
 * `/admin` に使用量は出しているが、見に行かないと分からない。人は見に行かない。
 * 「気づいたら超えていた」を防ぐには、近づいた時にこちらから知らせる必要がある。
 *
 * 段階が上がった時だけ通知する（同じ段階で毎日鳴ると読み飛ばされ、
 * 本当に危ない時に効かなくなる）。下がった時は黙って記録だけ戻す。
 */
const THRESHOLDS = [90, 70] as const;

type ResourceKey = "storage" | "database";

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  storage: "ストレージ（R2）",
  database: "データベース",
};

/** 超えた時にまず何をすればいいかまで書く。数字だけ言われても動けないため */
const RESOURCE_ACTION: Record<ResourceKey, string> = {
  storage:
    "`/admin` のメディア一覧から不要な動画を消すか、「孤児ファイル」の件数を確認してください。",
  database:
    "`/admin` のエラー記録が溜まっていないか確認してください。メディアの実体はストレージ側なので、DBが増える主因はレコード数です。",
};

function levelOf(percent: number): number {
  return THRESHOLDS.find((t) => percent >= t) ?? 0;
}

async function readLevels(): Promise<Partial<Record<ResourceKey, number>>> {
  const raw = await getAppSetting(APP_SETTING_KEYS.usageAlertLevels);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // 壊れた値が混ざっていても以降の比較を狂わせないよう、数値だけ受け入れる
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === "number")
    ) as Partial<Record<ResourceKey, number>>;
  } catch {
    return {};
  }
}

export type UsageAlertResult = {
  checked: { resource: ResourceKey; percent: number; level: number }[];
  notified: ResourceKey[];
  /** 通知先が未設定など、通知できなかった理由 */
  skipped: string | null;
};

export async function checkFreeTierUsage(): Promise<UsageAlertResult> {
  const [storage, database] = await Promise.all([getStorageStats(), getDatabaseStats()]);

  const current: { resource: ResourceKey; percent: number; level: number }[] = [];

  // 取得できなかったリソースは黙って飛ばす。見張りが落ちて本体を巻き込まないように
  // （取得失敗自体は /admin 側に理由が出る）。
  if (storage.ok && !storage.value.notConfigured && storage.value.limitBytes > 0) {
    const percent = (storage.value.totalBytes / storage.value.limitBytes) * 100;
    current.push({ resource: "storage", percent, level: levelOf(percent) });
  }
  if (database.ok && database.value.limitBytes > 0) {
    const percent = (database.value.sizeBytes / database.value.limitBytes) * 100;
    current.push({ resource: "database", percent, level: levelOf(percent) });
  }

  const previous = await readLevels();
  const rising = current.filter((c) => c.level > (previous[c.resource] ?? 0));

  // 上がっていなくても記録は更新する（下がった分を戻さないと、
  // 一度90%に触れたリソースが二度と通知されなくなる）。
  //
  // ただし**今回取得できたリソースだけを上書きする**。取得に失敗したものまで
  // 消してしまうと、R2が一時的に落ちた回を挟んだだけで記録が失われ、
  // 次に成功した回に「0から上がった」と誤判定して同じ段階で鳴り直す。
  // それはこの仕組みが防ごうとしている連投そのものになる。
  const nextLevels: Record<string, number> = { ...previous };
  for (const c of current) nextLevels[c.resource] = c.level;
  await setAppSetting(APP_SETTING_KEYS.usageAlertLevels, JSON.stringify(nextLevels));

  if (rising.length === 0) {
    return { checked: current, notified: [], skipped: null };
  }

  const channelId = await getAppSetting(APP_SETTING_KEYS.errorNotifyChannelId);
  if (!channelId) {
    return { checked: current, notified: [], skipped: "通知先チャンネルが未設定" };
  }

  const notified: ResourceKey[] = [];
  for (const r of rising) {
    const detail =
      r.resource === "storage" && storage.ok && !storage.value.notConfigured
        ? `${formatBytes(storage.value.totalBytes)} / ${formatBytes(storage.value.limitBytes)}`
        : database.ok && r.resource === "database"
          ? `${formatBytes(database.value.sizeBytes)} / ${formatBytes(database.value.limitBytes)}`
          : "";

    const icon = r.level >= 90 ? "🚨" : "⚠️";
    const posted = await postDiscordMessage(
      channelId,
      [
        `${icon} **${RESOURCE_LABEL[r.resource]}の使用率が${r.level}%を超えました**`,
        detail ? `**現在**: ${detail}（${r.percent.toFixed(1)}%）` : null,
        RESOURCE_ACTION[r.resource],
        "無料枠を超えると課金が発生します。",
      ]
        .filter(Boolean)
        .join("\n")
    );
    if (posted) notified.push(r.resource);
  }

  return { checked: current, notified, skipped: null };
}
