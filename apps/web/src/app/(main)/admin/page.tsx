import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { AlertCircle, Database, HardDrive, Youtube } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import {
  getStorageStats,
  getDatabaseStats,
  getMediaCounts,
  getYoutubeStats,
  formatBytes,
} from "@/lib/adminStats";
import { AdminNav } from "@/components/admin/AdminNav";
import { UsageBar } from "@/components/admin/UsageBar";
import { SectionError } from "@/components/admin/SectionError";

// 管理者ページ（使用量）：課金・クォータに効く数字だけを集めて出す。
//
// 計測できないものは黙って0を出さず、理由付きで「計測対象外」と書く。
// 中途半端な数字を並べると、それを見て判断してしまうため。
//
// 各セクションは独立して失敗しうる（テーブル未作成、R2トークンの権限不足など）。
// 1つコケてもページ全体は落とさず、そのセクションに理由を出す。
export const dynamic = "force-dynamic";

export default async function AdminUsagePage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const [storageResult, databaseResult, mediaResult, youtubeResult] =
    await Promise.all([
      getStorageStats(),
      getDatabaseStats(),
      getMediaCounts(),
      getYoutubeStats(),
    ]);

  const maxUnits = youtubeResult.ok
    ? Math.max(...youtubeResult.value.history.map((h) => h.units), 1)
    : 1;

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        使用量
      </h1>
      <AdminNav />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ストレージ（R2） */}
        <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
          <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
            <HardDrive size={12} /> ストレージ（Cloudflare R2）
          </h2>

          {!storageResult.ok ? (
            <SectionError message={storageResult.error} />
          ) : storageResult.value.notConfigured ? (
            <p className="mt-3 font-mono text-xs text-steam-muted">
              STORAGE_* が設定されていないため、バケットを参照できませんでした。
            </p>
          ) : (
            <>
              <div className="mt-3">
                <UsageBar
                  label="保存容量"
                  used={storageResult.value.totalBytes}
                  limit={storageResult.value.limitBytes}
                  usedLabel={formatBytes(storageResult.value.totalBytes)}
                  limitLabel={formatBytes(storageResult.value.limitBytes)}
                  note="バケットを直接列挙した実測値（請求対象と一致）"
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2">
                {[
                  [
                    "オブジェクト数",
                    storageResult.value.objectCount.toLocaleString(),
                  ],
                  ["画像", formatBytes(storageResult.value.photoBytes)],
                  ["動画", formatBytes(storageResult.value.videoBytes)],
                  [
                    "孤児ファイル",
                    storageResult.value.orphanCount === 0
                      ? "なし"
                      : `${storageResult.value.orphanCount}件 / ${formatBytes(storageResult.value.orphanBytes)}`,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-sm border border-steam-border bg-steam-panel p-3"
                  >
                    <dt className="font-mono text-4xs text-steam-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 font-display text-lg font-bold text-steam-text">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {storageResult.value.orphanCount > 0 && (
                <p className="mt-2 flex items-start gap-1.5 font-mono text-4xs text-[#e0a323]">
                  <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                  DBのどのレコードからも参照されていないファイルです。動画のサムネイルは
                  Photoレコードを持たない設計なので、その分はここに含まれます。
                </p>
              )}
            </>
          )}
        </section>

        {/* データベース */}
        <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6">
          <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
            <Database size={12} /> データベース
          </h2>
          {!databaseResult.ok ? (
            <SectionError message={databaseResult.error} />
          ) : (
            <div className="mt-3">
              <UsageBar
                label="使用容量"
                used={databaseResult.value.sizeBytes}
                limit={databaseResult.value.limitBytes}
                usedLabel={formatBytes(databaseResult.value.sizeBytes)}
                limitLabel={formatBytes(databaseResult.value.limitBytes)}
                note="pg_database_size() の実測値"
              />
            </div>
          )}

          {!mediaResult.ok ? (
            <SectionError message={mediaResult.error} />
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                {[
                  [
                    "画像レコード",
                    `${mediaResult.value.images.toLocaleString()}件`,
                  ],
                  [
                    "動画レコード",
                    `${mediaResult.value.videos.toLocaleString()}件`,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-sm border border-steam-border bg-steam-panel p-3"
                  >
                    <dt className="font-mono text-4xs text-steam-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 font-display text-lg font-bold text-steam-text">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {mediaResult.value.missingSize > 0 && (
                <p className="mt-2 font-mono text-4xs text-steam-muted/70">
                  うち{mediaResult.value.missingSize}
                  件はサイズ未記録（Discord経由の投稿など）。容量はストレージ側の実測を参照。
                </p>
              )}
            </>
          )}
        </section>

        {/* YouTube Data API */}
        <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6 lg:col-span-2">
          <h2 className="flex items-center gap-1.5 font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
            <Youtube size={12} /> YouTube Data API（本日・UTC基準）
          </h2>
          {!youtubeResult.ok ? (
            <SectionError message={youtubeResult.error} />
          ) : (
            <div className="mt-3">
              <UsageBar
                label="クォータ"
                used={youtubeResult.value.todayUnits}
                limit={youtubeResult.value.dailyQuota}
                usedLabel={`${youtubeResult.value.todayUnits.toLocaleString()} ユニット`}
                limitLabel={`${youtubeResult.value.dailyQuota.toLocaleString()} ユニット`}
                note={`本日の検索 ${youtubeResult.value.todayCalls} 回（search.listは1回100ユニット＝実質100回/日）`}
              />
            </div>
          )}

          {youtubeResult.ok && youtubeResult.value.history.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-4xs text-steam-muted">直近30日</p>
              <div className="mt-2 flex flex-col gap-1">
                {youtubeResult.value.history.map((h) => (
                  <div key={h.date} className="flex items-center gap-2">
                    <span className="w-20 flex-shrink-0 font-mono text-4xs text-steam-muted/70">
                      {h.date}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-steam-panel">
                      <div
                        className="h-full rounded-sm bg-steam-blue/70"
                        style={{ width: `${(h.units / maxUnits) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 flex-shrink-0 text-right font-mono text-4xs text-steam-muted">
                      {h.calls}回 / {h.units}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 計測できないもの */}
        <section className="rounded-sm border border-steam-border bg-steam-surface p-4 sm:p-6 lg:col-span-2">
          <h2 className="font-mono text-3xs font-bold uppercase tracking-wide text-steam-muted">
            計測対象外
          </h2>
          <ul className="mt-3 flex flex-col gap-2 font-mono text-3xs text-steam-muted">
            <li>
              <span className="text-steam-text">IsThereAnyDeal / Steam</span> —
              Next.jsのデータキャッシュ越しに呼んでいるため、コード側から「実際に外部へ出たか」を判別できません。呼び出し地点で数えるとキャッシュヒットも1回と数えてしまい、実態より多く出ます。
            </li>
            <li>
              <span className="text-steam-text">
                Vercel（実行時間・転送量）
              </span>{" "}
              —
              アプリ内からは取得できません。Vercelのダッシュボード、またはAPIトークンを用意した連携が必要です。
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
