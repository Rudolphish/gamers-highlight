// パッチノート（content/patchNotes.ts）を Discord へ送る（2026-11-03 ユーザー判断）。
//
// - **送るのは管理者が /admin/release-notes で「送る」を押したときだけ。** デプロイしただけでは送らない
//   （本番で動くのを確かめてから出すため）
// - 送り先はグループごとの通知の種類 RELEASE_NOTES。**行が無いグループには送らない**（ほかの通知と同じ）
// - 送った記録はパッチノートの版ごとに AppSetting（`releaseNoteSent:<版>`）へ、グループ ID → 送った時刻の JSON で持つ。
//   **送れたグループだけを記録する**ので、失敗したグループはもう一度押せばそこだけ送り直せる
//   （CLAUDE.md「取りこぼさないための記録は、失敗したら進めてはいけない」）。送った後に送り先を足したグループも同じ
// - 埋め込み（色付きの枠）で送る。上限は lib-checks が @discordjs/builders の検査に通して見ている
import { db } from "./db";
import { postDiscordEmbed, type DiscordEmbed } from "./discord";
import { listNotificationTargets } from "./notificationTargets";
import { THEME_COLORS } from "./themeColors";
import { PATCH_NOTE_SECTIONS, patchNoteDateLabel, type PatchNote } from "@/content/patchNotes";

/** 既定のテーマ（ブルー）の色。favicon やホーム画面のアイコンと同じく、送る側はブルーで固定する */
const EMBED_COLOR = parseInt(THEME_COLORS[0].accent.slice(1), 16);

export function releaseNoteTitle(note: PatchNote): string {
  return `ShareStaq v${note.version} の更新のお知らせ（${patchNoteDateLabel(note.date)}）`;
}

/** 送る埋め込み。空の区分は出さない。`appUrl` があれば題名を「更新履歴」のページへのリンクにする */
export function buildReleaseEmbed(note: PatchNote, appUrl: string | null): DiscordEmbed {
  const base = appUrl?.replace(/\/+$/, "") ?? null;
  return {
    title: releaseNoteTitle(note),
    ...(base ? { url: `${base}/updates` } : {}),
    color: EMBED_COLOR,
    fields: PATCH_NOTE_SECTIONS.filter((s) => note[s.key].length > 0).map((s) => ({
      name: `${s.emoji} ${s.label}`,
      value: note[s.key].map((line) => `・${line}`).join("\n"),
    })),
    footer: { text: "これまでの更新は ShareStaq の「更新履歴」で見られます" },
  };
}

export const releaseNoteSentKey = (version: string) => `releaseNoteSent:${version}`;

/** その版を送ったグループ ID → 送った時刻（ISO） */
export async function readReleaseNoteSent(version: string): Promise<Record<string, string>> {
  const row = await db.appSetting.findUnique({ where: { key: releaseNoteSentKey(version) } });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export type ReleaseNoteGroupStatus = {
  groupId: string;
  groupName: string;
  /** 送り先（RELEASE_NOTES）が無ければ null */
  channelId: string | null;
  sentAt: string | null;
};

/** 全グループの、その版の送り先と送った記録 */
export async function releaseNoteStatus(version: string): Promise<ReleaseNoteGroupStatus[]> {
  const [groups, targets, sent] = await Promise.all([
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listNotificationTargets("RELEASE_NOTES"),
    readReleaseNoteSent(version),
  ]);
  const channelOf = new Map(targets.map((t) => [t.groupId, t.channelId]));
  return groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    channelId: channelOf.get(g.id) ?? null,
    sentAt: sent[g.id] ?? null,
  }));
}

export type ReleaseNoteSendResult = { sent: number; failed: number; already: number; noTarget: number };

/**
 * まだ送っていないグループ（送り先があるものだけ）へ送る。送れたグループを1件ずつ記録する。
 * 同じチャンネルを送り先にしているグループが複数あっても、**1つのチャンネルへは1回だけ**送る（両方を送った扱いにする）
 */
export async function sendReleaseNote(note: PatchNote, appUrl: string | null): Promise<ReleaseNoteSendResult> {
  const status = await releaseNoteStatus(note.version);
  const result: ReleaseNoteSendResult = { sent: 0, failed: 0, already: 0, noTarget: 0 };
  const embed = buildReleaseEmbed(note, appUrl);
  const postedChannels = new Set<string>();
  for (const g of status) {
    if (!g.channelId) {
      result.noTarget++;
      continue;
    }
    if (g.sentAt) {
      result.already++;
      postedChannels.add(g.channelId);
      continue;
    }
    if (!postedChannels.has(g.channelId)) {
      if (!(await postDiscordEmbed(g.channelId, embed))) {
        result.failed++;
        console.error(`[release-notes] v${note.version} を送れませんでした groupId=${g.groupId} channelId=${g.channelId}`);
        continue;
      }
      postedChannels.add(g.channelId);
    }
    // 送れたグループだけ記録する（読み直してから足す。続けて押されても、ほかのグループの記録を消さない）
    const sent = await readReleaseNoteSent(note.version);
    sent[g.groupId] = new Date().toISOString();
    await db.appSetting.upsert({
      where: { key: releaseNoteSentKey(note.version) },
      create: { key: releaseNoteSentKey(note.version), value: JSON.stringify(sent) },
      update: { value: JSON.stringify(sent) },
    });
    result.sent++;
  }
  return result;
}
