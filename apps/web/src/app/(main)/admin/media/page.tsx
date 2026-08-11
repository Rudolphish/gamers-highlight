import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { Film, Image as ImageIcon } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { formatBytes } from "@/lib/adminStats";
import { AdminNav } from "@/components/admin/AdminNav";

const PAGE_SIZE = 100;

// 管理者ページ（メディア一覧）：グループ・アルバムをまたいで全ての画像/動画を一覧する。
// 通常画面はアルバム単位でしか見られないので、未分類やDiscord経由の投稿を含めて
// 「全部でどれだけあるか」をここで把握できるようにする。
export const dynamic = "force-dynamic";

type Search = { page?: string; type?: string };

export default async function AdminMediaPage({ searchParams }: { searchParams: Search }) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const type: "IMAGE" | "VIDEO" | null =
    searchParams.type === "IMAGE" || searchParams.type === "VIDEO" ? searchParams.type : null;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const where = type ? { mediaType: type } : {};

  const [total, photos] = await Promise.all([
    db.photo.count({ where }),
    db.photo.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        uploader: true,
        album: { include: { group: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (params: Search) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.page && params.page !== "1") q.set("page", params.page);
    const s = q.toString();
    return `/admin/media${s ? `?${s}` : ""}`;
  };

  const FILTERS: { label: string; value: string | null }[] = [
    { label: "すべて", value: null },
    { label: "画像", value: "IMAGE" },
    { label: "動画", value: "VIDEO" },
  ];

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">メディア一覧</h1>
      <AdminNav />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={href({ type: f.value ?? undefined })}
            className={`rounded-sm border px-2 py-1 font-mono text-3xs transition ${
              type === f.value
                ? "border-steam-blue text-steam-blue"
                : "border-steam-border text-steam-muted hover:border-steam-blue"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-2 font-mono text-3xs text-steam-muted">
          {total.toLocaleString()}件（{page}/{lastPage}ページ）
        </span>
      </div>

      {photos.length === 0 ? (
        <p className="mt-6 font-mono text-sm text-steam-muted">該当するメディアがありません。</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-sm border border-steam-border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-steam-panel text-left font-mono text-4xs uppercase tracking-wide text-steam-muted">
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">ゲーム / ファイル</th>
                <th className="px-3 py-2">投稿者</th>
                <th className="px-3 py-2">アルバム</th>
                <th className="px-3 py-2 text-right">サイズ</th>
                <th className="px-3 py-2">投稿日</th>
                <th className="px-3 py-2">経路</th>
              </tr>
            </thead>
            <tbody>
              {photos.map((p) => (
                <tr key={p.id} className="border-t border-steam-border bg-steam-surface align-middle">
                  <td className="px-3 py-2">
                    {p.mediaType === "VIDEO" ? (
                      <Film size={13} className="text-steam-blue" />
                    ) : (
                      <ImageIcon size={13} className="text-steam-blue" />
                    )}
                  </td>
                  <td className="max-w-[220px] px-3 py-2">
                    <a
                      href={p.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-mono text-3xs text-steam-text hover:text-steam-blue"
                      title={p.mediaUrl}
                    >
                      {p.gameTitle || p.mediaUrl.split("/").pop()}
                    </a>
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 font-mono text-3xs text-steam-muted">
                    {p.uploader.name ?? p.uploader.email ?? "-"}
                  </td>
                  <td className="max-w-[200px] px-3 py-2 font-mono text-3xs">
                    {p.album ? (
                      <Link
                        href={`/albums/${p.album.id}`}
                        className="block truncate text-steam-muted hover:text-steam-blue"
                      >
                        {p.album.group.name} / {p.album.title}
                      </Link>
                    ) : (
                      <span className="text-steam-muted/60">未分類</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-3xs text-steam-muted">
                    {p.sizeBytes ? formatBytes(p.sizeBytes) : "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-3xs text-steam-muted/70">
                    {p.createdAt.toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 font-mono text-4xs text-steam-muted/70">
                    {p.source === "DISCORD" ? "Discord" : "手動"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="mt-4 flex items-center gap-2">
          {page > 1 && (
            <Link
              href={href({ type: type ?? undefined, page: String(page - 1) })}
              className="rounded-sm border border-steam-border px-3 py-1.5 font-mono text-3xs text-steam-text hover:border-steam-blue"
            >
              前へ
            </Link>
          )}
          {page < lastPage && (
            <Link
              href={href({ type: type ?? undefined, page: String(page + 1) })}
              className="rounded-sm border border-steam-border px-3 py-1.5 font-mono text-3xs text-steam-text hover:border-steam-blue"
            >
              次へ
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
