import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { Film, Image as ImageIcon, LayoutGrid, List, Youtube } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { formatBytes } from "@/lib/adminStats";
import { AdminNav } from "@/components/admin/AdminNav";
import { DeleteMediaButton } from "@/components/admin/DeleteMediaButton";
import { AdminAssignProvider, AssignButton, AssignCheckbox } from "@/components/admin/AdminAssignUnclassified";
import { getCurrentUser } from "@/lib/currentUser";
import { getAssignTargets } from "@/lib/assignTargets";
import type { MediaKind } from "@/lib/mediaKind";

const PAGE_SIZE = 100;

// 管理者ページ（メディア一覧）：グループ・アルバムをまたいで全ての画像/動画を一覧する。
// 通常画面はアルバム単位でしか見られないので、未分類やDiscord経由の投稿を含めて
// 「全部でどれだけあるか」をここで把握できるようにする。
//
// **未分類の投稿は、誰の投稿でもここから振り分けられる**（チェックしてまとめて、または1件ずつ。
// 2026-10-15 ユーザー判断）。振り分け先は管理者自身が編集できるアルバムだけ。
//
// 表示形式（一覧/サムネイル）と絞り込みはURLに持つ。ページ送りのリンクと同じ扱いにして、
// ページを移動しても選んだ表示が保たれるようにするため。
export const dynamic = "force-dynamic";

type Search = { page?: string; type?: string; view?: string; album?: string };

export default async function AdminMediaPage(props: { searchParams: Promise<Search> }) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();

  const type: MediaKind | null =
    searchParams.type === "IMAGE" || searchParams.type === "VIDEO" || searchParams.type === "YOUTUBE"
      ? searchParams.type
      : null;
  const view: "list" | "grid" = searchParams.view === "grid" ? "grid" : "list";
  const page = Math.max(1, Number(searchParams.page) || 1);
  /** 未分類（どのアルバムにも入っていない）だけに絞るか。種別の絞り込みとは別に掛け合わせる */
  const unassignedOnly = searchParams.album === "none";
  const where = { ...(type ? { mediaType: type } : {}), ...(unassignedOnly ? { albumId: null } : {}) };

  const me = await getCurrentUser();
  const [total, photos, targets] = await Promise.all([
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
    me ? getAssignTargets(me.id) : Promise.resolve({ albums: [], groups: [] }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (params: Search) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.album === "none") q.set("album", "none");
    if (params.view === "grid") q.set("view", "grid");
    if (params.page && params.page !== "1") q.set("page", params.page);
    const s = q.toString();
    return `/admin/media${s ? `?${s}` : ""}`;
  };

  const FILTERS: { label: string; value: string | null }[] = [
    { label: "すべて", value: null },
    { label: "画像", value: "IMAGE" },
    { label: "動画", value: "VIDEO" },
    { label: "YouTube", value: "YOUTUBE" },
  ];

  const VIEWS: { label: string; value: "list" | "grid"; icon: typeof List }[] = [
    { label: "一覧", value: "list", icon: List },
    { label: "サムネイル", value: "grid", icon: LayoutGrid },
  ];

  /** 一覧に出す名前。ゲーム名が無ければファイル名で代用する */
  const displayName = (p: (typeof photos)[number]) =>
    p.gameTitle || p.mediaUrl.split("/").pop() || "無題";

  /** サムネイルに使うURL。Discord経由の動画はサムネイルを持たない */
  const thumbnailFor = (p: (typeof photos)[number]) =>
    p.mediaType === "IMAGE" ? p.mediaUrl : p.thumbnailUrl;

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">メディア一覧</h1>
      <AdminNav />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={href({ type: f.value ?? undefined, view, album: searchParams.album })}
            className={`rounded-sm border px-2 py-1 text-3xs transition ${
              type === f.value
                ? "border-steam-blue text-steam-blue"
                : "border-steam-border text-steam-muted hover:border-steam-blue"
            }`}
          >
            {f.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-steam-border" />

        <Link
          href={href({ type: type ?? undefined, view, album: unassignedOnly ? undefined : "none" })}
          className={`rounded-sm border px-2 py-1 text-3xs transition ${
            unassignedOnly
              ? "border-steam-blue text-steam-blue"
              : "border-steam-border text-steam-muted hover:border-steam-blue"
          }`}
        >
          未分類のみ
        </Link>

        <span className="mx-1 h-4 w-px bg-steam-border" />

        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={href({ type: type ?? undefined, view: v.value, album: searchParams.album })}
            aria-label={v.label}
            title={v.label}
            className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-3xs transition ${
              view === v.value
                ? "border-steam-blue text-steam-blue"
                : "border-steam-border text-steam-muted hover:border-steam-blue"
            }`}
          >
            <v.icon size={11} /> {v.label}
          </Link>
        ))}

        <span className="ml-2 text-3xs text-steam-muted">
          {total.toLocaleString()}件（{page}/{lastPage}ページ）
        </span>
      </div>

      <AdminAssignProvider albums={targets.albums} groups={targets.groups}>
      {photos.length === 0 ? (
        <p className="mt-6 text-sm text-steam-muted">該当するメディアがありません。</p>
      ) : view === "grid" ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((p) => {
            const thumb = thumbnailFor(p);
            return (
              <div
                key={p.id}
                className="overflow-hidden rounded-xl bg-steam-surface"
              >
                <div className="relative aspect-square w-full bg-steam-panel">
                  {thumb ? (
                    <a href={p.mediaUrl} target="_blank" rel="noreferrer">
                      <Image
                        src={thumb}
                        alt={displayName(p)}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 768px) 25vw, 16vw"
                        className="object-cover transition hover:brightness-110"
                      />
                    </a>
                  ) : (
                    // Discord経由の動画などサムネイルが無いもの
                    <div className="flex h-full w-full items-center justify-center">
                      <Film size={20} className="text-steam-muted/50" />
                    </div>
                  )}

                  {p.mediaType !== "IMAGE" && (
                    <span className="absolute left-1 top-1 rounded-sm bg-black/60 p-1 backdrop-blur-sm">
                      {p.mediaType === "YOUTUBE" ? (
                        <Youtube size={10} className="text-[#ff4d4d]" />
                      ) : (
                        <Film size={10} className="text-steam-blue" />
                      )}
                    </span>
                  )}
                  <span className="absolute right-1 top-1 flex items-center gap-1">
                    {!p.albumId && <AssignButton photoId={p.id} compact />}
                    <DeleteMediaButton photoId={p.id} label={displayName(p)} compact />
                  </span>
                  {!p.albumId && (
                    <span className="absolute bottom-1 left-1 rounded-sm bg-black/60 p-1 backdrop-blur-sm">
                      <AssignCheckbox photoId={p.id} label={displayName(p)} />
                    </span>
                  )}
                </div>

                <div className="p-1.5">
                  <p className="truncate text-4xs text-steam-text">{displayName(p)}</p>
                  <p className="truncate text-4xs text-steam-muted">
                    {p.uploader.name ?? p.uploader.email ?? "-"}
                    {p.sizeBytes ? `・${formatBytes(p.sizeBytes)}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-sm border border-steam-border">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="bg-steam-panel text-left text-4xs uppercase tracking-wide text-steam-muted">
                <th className="px-3 py-2" aria-label="選択" />
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">ゲーム / ファイル</th>
                <th className="px-3 py-2">投稿者</th>
                <th className="px-3 py-2">アルバム</th>
                <th className="px-3 py-2 text-right">サイズ</th>
                <th className="px-3 py-2">投稿日</th>
                <th className="px-3 py-2">経路</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {photos.map((p) => (
                <tr key={p.id} className="border-t border-steam-border bg-steam-surface align-middle">
                  <td className="px-3 py-2">
                    {!p.albumId && <AssignCheckbox photoId={p.id} label={displayName(p)} />}
                  </td>
                  <td className="px-3 py-2">
                    {p.mediaType === "YOUTUBE" ? (
                      <Youtube size={13} className="text-[#ff4d4d]" />
                    ) : p.mediaType === "VIDEO" ? (
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
                      className="block truncate text-3xs text-steam-text hover:text-steam-blue"
                      title={p.mediaUrl}
                    >
                      {displayName(p)}
                    </a>
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 text-3xs text-steam-muted">
                    {p.uploader.name ?? p.uploader.email ?? "-"}
                  </td>
                  <td className="max-w-[200px] px-3 py-2 text-3xs">
                    {p.album ? (
                      <Link
                        href={`/albums/${p.album.id}`}
                        className="block truncate text-steam-muted hover:text-steam-blue"
                      >
                        {p.album.group.name} / {p.album.title}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-steam-muted">未分類</span>
                        <AssignButton photoId={p.id} />
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-3xs text-steam-muted">
                    {p.sizeBytes ? formatBytes(p.sizeBytes) : "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-3xs text-steam-muted">
                    {p.createdAt.toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 text-4xs text-steam-muted">
                    {p.source === "DISCORD" ? "Discord" : "手動"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeleteMediaButton photoId={p.id} label={displayName(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </AdminAssignProvider>

      {lastPage > 1 && (
        <div className="mt-4 flex items-center gap-2">
          {page > 1 && (
            <Link
              href={href({ type: type ?? undefined, view, page: String(page - 1), album: searchParams.album })}
              className="rounded-sm border border-steam-border px-3 py-1.5 text-3xs text-steam-text hover:border-steam-blue"
            >
              前へ
            </Link>
          )}
          {page < lastPage && (
            <Link
              href={href({ type: type ?? undefined, view, page: String(page + 1), album: searchParams.album })}
              className="rounded-sm border border-steam-border px-3 py-1.5 text-3xs text-steam-text hover:border-steam-blue"
            >
              次へ
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
