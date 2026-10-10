"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Gamepad2, X, Search, ImageIcon, Link2Off, AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type SteamResult = { appId: number; name: string; thumbnail: string };

// アルバムのSteam連携。2つの別物を同じモーダルで扱う。
//
//   1. サムネイル … `Album.steamAppId`。アルバムのカバーにSteamのヘッダー画像を使う
//   2. ゲームとの連携 … `GroupGame.albumId`。アルバムから「ゲーム詳細」へ辿れるようにする
//
// **以前はこの2つが見分けられなかった。** ボタンがアイコンだけで、しかも連携済みのときは
// 検索結果の**全行**が同じチェックマークに変わる作りだったため、どのゲームと連携しているのか、
// どのボタンが何をするのかが画面から読めなかった（「アイコンが分かりづらい」という報告）。
// いまは文字を添え、連携中のゲームだけに印を出す。
//
// **付け替えも解除もできる。** 以前は一度連携すると `POST /api/groups/:id/games` が409を返し、
// 間違えたときに直す経路が無かった（アルバムから辿るゲーム詳細が別のゲームのまま固定された）。
export function SteamCoverPicker({
  albumId,
  groupId,
  initialQuery,
  hasSteamCover,
  linkedGameId,
  linkedGameTitle,
  linkedSteamAppId,
}: {
  albumId: string;
  groupId: string;
  initialQuery: string;
  hasSteamCover: boolean;
  linkedGameId?: string | null;
  linkedGameTitle?: string | null;
  linkedSteamAppId?: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  // 付け替えの確認待ち。**黙って上書きしない**——連携済みのゲームが
  // 他のメンバーの「気になる」を持っていることがあるため
  const [pendingRelink, setPendingRelink] = useState<SteamResult | null>(null);
  const [alsoRemovePrevious, setAlsoRemovePrevious] = useState(false);

  const busy =
    applyingId !== null || linkingId !== null || clearing || unlinking || searching;

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/steam/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results ?? []);
      setSearched(true);
    } catch {
      setError("Steamの検索に失敗しました");
    } finally {
      setSearching(false);
    }
  }

  /** サムネイルだけ差し替える（ゲームとの連携には触らない） */
  async function applyCover(appId: number) {
    setApplyingId(appId);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamAppId: appId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      router.refresh();
    } catch {
      setError("画像の設定に失敗しました");
    } finally {
      setApplyingId(null);
    }
  }

  /**
   * ゲームと連携する。連携済みなら**付け替え**になる。
   * サムネイルも新しいゲームに合わせる（APIが一緒に更新する）。
   */
  async function linkGame(result: SteamResult, removePrevious: boolean) {
    setLinkingId(result.appId);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/game`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
          removePrevious,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "連携に失敗しました");
      }
      setPendingRelink(null);
      setAlsoRemovePrevious(false);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "連携に失敗しました");
    } finally {
      setLinkingId(null);
    }
  }

  /** 連携だけ外す。ゲームはリストに残り、サムネイルもそのまま */
  async function unlinkGame() {
    setUnlinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/game`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamAppId: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      router.refresh();
    } catch {
      setError("連携の解除に失敗しました");
    } finally {
      setUnlinking(false);
    }
  }

  /** サムネイルを投稿写真に戻す（連携には触らない） */
  async function clearCover() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamAppId: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      router.refresh();
    } catch {
      setError("解除に失敗しました");
    } finally {
      setClearing(false);
    }
  }

  function requestLink(result: SteamResult) {
    // 連携済みで、かつ別のゲームを選んだときだけ確認を挟む
    if (linkedGameId && linkedSteamAppId !== result.appId) {
      setPendingRelink(result);
      setAlsoRemovePrevious(false);
      return;
    }
    void linkGame(result, false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-sm border border-steam-border px-3 py-2 font-mono text-xs text-steam-text hover:border-steam-blue"
      >
        <Gamepad2 size={13} /> Steam連携
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border border-steam-border bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">Steam連携</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="p-2 text-steam-muted hover:text-steam-text"
              >
                <X size={16} />
              </button>
            </div>

            {/* **いま何と連携しているかを名前で出す。** これが無いと、間違ったゲームに
                連携していることに気づけない（実際にそうなった） */}
            <div className="mt-3 rounded-sm border border-steam-border bg-steam-panel p-2.5">
              {linkedGameId ? (
                <>
                  <p className="font-mono text-2xs text-steam-text">
                    {`現在のゲーム: ${linkedGameTitle ?? "（名称不明）"}`}
                  </p>
                  <p className="mt-1 font-mono text-4xs text-steam-muted/70">
                    アルバムの「ゲーム詳細を見る」はこのゲームを指しています。違っていたら、
                    下で検索して「このゲームに連携」を押すと付け替えられます。
                  </p>
                  <button
                    onClick={unlinkGame}
                    disabled={busy}
                    className="mt-2 flex items-center gap-1 font-mono text-3xs text-steam-muted transition hover:text-[#eb4b4b] disabled:opacity-50"
                  >
                    {unlinking ? <Spinner size={11} /> : <Link2Off size={11} />}
                    ゲームとの連携を解除する（ゲームはリストに残ります）
                  </button>
                </>
              ) : (
                <p className="font-mono text-2xs text-steam-muted">
                  このアルバムはまだゲームと連携していません。
                </p>
              )}
            </div>

            {/* 付け替えの確認。チェックを入れると元のゲームをリストからも消す */}
            {pendingRelink && (
              <div className="mt-3 rounded-sm border border-[#eb4b4b]/50 bg-steam-panel p-2.5">
                <p className="flex items-start gap-1.5 font-mono text-2xs text-steam-text">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-[#eb4b4b]" />
                  {`「${linkedGameTitle ?? "現在のゲーム"}」から「${pendingRelink.name}」に付け替えます。`}
                </p>
                <label className="mt-2 flex items-start gap-1.5 font-mono text-3xs text-steam-muted">
                  <input
                    type="checkbox"
                    checked={alsoRemovePrevious}
                    onChange={(e) => setAlsoRemovePrevious(e.target.checked)}
                    className="mt-0.5"
                  />
                  {`「${linkedGameTitle ?? "現在のゲーム"}」をグループのゲームリストからも削除する（他のメンバーの「気になる」も消えます）`}
                </label>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => linkGame(pendingRelink, alsoRemovePrevious)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-1.5 font-mono text-3xs font-bold text-[#0e1b12] disabled:opacity-40"
                  >
                    {linkingId === pendingRelink.appId ? <Spinner size={11} /> : null}
                    付け替える
                  </button>
                  <button
                    onClick={() => setPendingRelink(null)}
                    disabled={busy}
                    className="rounded-sm border border-steam-border px-3 py-1.5 font-mono text-3xs text-steam-muted disabled:opacity-50"
                  >
                    やめる
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ゲーム名で検索"
                disabled={searching}
                aria-label="ゲーム名で検索"
                className="flex-1 rounded-sm border border-steam-border bg-steam-bg px-3 py-2 font-mono text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-gradient-to-r from-[#4c6b22] to-[#a4d007] px-3 py-2 font-mono text-xs font-bold text-[#0e1b12] disabled:opacity-40"
              >
                {searching ? <Spinner size={12} /> : <Search size={12} />}
                検索
              </button>
            </div>

            <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {results.map((r) => {
                const isLinked = linkedGameId != null && linkedSteamAppId === r.appId;
                return (
                  <div
                    key={r.appId}
                    className="rounded-sm border border-steam-border bg-steam-panel p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Image
                        src={r.thumbnail}
                        alt=""
                        width={64}
                        height={40}
                        className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-steam-text">
                        {r.name}
                      </span>
                      {/* 印は**連携中のゲームだけ**に出す。以前は連携済みだと全行に
                          チェックが付き、どれと連携しているのか分からなかった */}
                      {isLinked && (
                        <span className="flex-shrink-0 rounded-sm border border-[#a4d007]/60 px-1.5 py-0.5 font-mono text-4xs text-[#a4d007]">
                          これと連携中
                        </span>
                      )}
                    </div>
                    {/* **アイコンだけにしない。** 2つのボタンが何をするのかは
                        アイコンでは伝わらなかった（ユーザー報告） */}
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => applyCover(r.appId)}
                        disabled={busy}
                        className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-steam-border px-2 py-1.5 font-mono text-3xs text-steam-text transition hover:border-steam-blue disabled:opacity-50"
                      >
                        {applyingId === r.appId ? <Spinner size={11} /> : <ImageIcon size={11} />}
                        サムネイルに使う
                      </button>
                      <button
                        onClick={() => requestLink(r)}
                        disabled={busy || isLinked}
                        className="flex flex-1 items-center justify-center gap-1 rounded-sm border border-steam-border px-2 py-1.5 font-mono text-3xs text-steam-text transition hover:border-steam-blue disabled:opacity-50"
                      >
                        {linkingId === r.appId ? <Spinner size={11} /> : <Gamepad2 size={11} />}
                        {isLinked ? "連携中" : linkedGameId ? "このゲームに付け替え" : "このゲームに連携"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {searched && !searching && results.length === 0 && (
                <p className="font-mono text-2xs text-steam-muted/70">見つかりませんでした</p>
              )}
            </div>

            {hasSteamCover && (
              <button
                onClick={clearCover}
                disabled={busy}
                className="mt-3 flex items-center gap-1 font-mono text-2xs text-[#eb4b4b] disabled:opacity-50"
              >
                {clearing && <Spinner size={11} />}
                Steam画像を解除して投稿写真に戻す
              </button>
            )}

            {error && <p className="mt-3 font-mono text-xs text-[#eb4b4b]">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
