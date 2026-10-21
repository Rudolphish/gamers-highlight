"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { X, Search, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { InterestButton, type InterestUser } from "@/components/group/InterestButton";
import { formatPlayDuration } from "@/lib/playDuration";
import { translateGenre } from "@/lib/steam";
import { ActivityIcon } from "@/components/activity/ActivityIcon";
import { GAME_STATUS_LABELS } from "@/lib/gameLabels";
import { BUTTON_HEIGHT, ICON_BUTTON_SIZE, chipBase, chipButton, ghostIconButton, textButton } from "@/components/ui/buttonStyles";

type GameStatus = "WISHLIST" | "PLAYING" | "BACKLOG" | "COMPLETED";

type GroupGameItem = {
  id: string;
  steamAppId: number;
  title: string;
  coverUrl: string | null;
  status: GameStatus;
  genres: string[];
  addedByName: string;
  /** グループで遊んだ時間（ミリ秒）。0 なら出さない。数え方は lib/playLog.ts の getGroupPlayTotals */
  playMs?: number;
  interestedUsers: InterestUser[];
};

type SteamResult = { appId: number; name: string; thumbnail: string };

const STATUS_LABEL: Record<GameStatus, string> = GAME_STATUS_LABELS;

const STATUS_BADGE_CLASS: Record<GameStatus, string> = {
  WISHLIST: "border-steam-blue/50 text-steam-blue",
  PLAYING: "border-positive/50 text-positive",
  BACKLOG: "border-warning/50 text-warning",
  COMPLETED: "border-steam-muted/50 text-steam-muted",
};

const STATUS_ORDER: GameStatus[] = ["PLAYING", "WISHLIST", "BACKLOG", "COMPLETED"];

/** 画面を開いた直後に選ばれているステータス（いま話題になるものだけ出す） */
const DEFAULT_STATUS_FILTER: GameStatus[] = ["PLAYING", "WISHLIST"];

/**
 * 絞り込みの保存先（ブラウザのlocalStorage）。
 *
 * **キーはグループ単位。** ジャンルはそのグループのゲームから作られるので、
 * 全グループで共有すると「別のグループには存在しないジャンル」が選ばれたままになり、
 * 開いた瞬間に0件、という状態になる。
 *
 * **末尾の版番号を上げると、保存済みの設定を捨てて既定からやり直せる。**
 * 保存を始めた以上 DEFAULT_STATUS_FILTER は「初めてそのグループを開いた人」にしか
 * 効かないので、既定を変えて全員に配り直したくなったらここを上げる。
 */
const FILTER_STORAGE_VERSION = "v1";
const filterStorageKey = (groupId: string) => `gh:game-filter:${FILTER_STORAGE_VERSION}:${groupId}`;

function isGameStatus(value: unknown): value is GameStatus {
  return typeof value === "string" && STATUS_ORDER.includes(value as GameStatus);
}

export function GroupGameList({
  groupId,
  games,
  canEdit,
  currentUserId,
  addOpen: open,
  onAddOpenChange: setOpen,
}: {
  groupId: string;
  games: GroupGameItem[];
  canEdit: boolean;
  currentUserId: string | null;
  /**
   * 「ゲームを追加」の検索モーダルを開いているか。ボタンは「みんなのゲーム」の見出しの横にある
   * （components/group/GroupGamesSection.tsx。アルバムの「新規アルバム」・ウィッシュリストの「追加する」と揃えた）
   */
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState(games);
  // ステータス・ジャンルとも複数選択できる。空＝絞り込みなし（＝すべて）。
  // 同じ枠の中はOR（「プレイ予定」＋「プレイ中」でどちらかに当てはまるもの）、
  // ステータス枠とジャンル枠の間はANDで効く。
  //
  // 初期状態は「プレイ中」と「プレイ予定」だけを表示する。いま話題になるのはこの2つで、
  // 積みゲーとクリア済みは溜まる一方なので、既定で全部出すと本数が増えるほど埋もれる。
  // 絞り込み中は件数と「条件をクリア」が出るので、すべて見たいときは1回押せば戻せる。
  const [statusFilter, setStatusFilter] = useState<Set<GameStatus>>(
    () => new Set<GameStatus>(DEFAULT_STATUS_FILTER)
  );
  const [genreFilter, setGenreFilter] = useState<Set<string>>(new Set());
  // 保存済みの設定を読み終えたか。読む前に保存すると、既定値で上書きしてしまう
  const [restored, setRestored] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // サーバーから最新データが届いたら（router.refresh()完了時など）楽観的な値を正に置き換える
  useEffect(() => setItems(games), [games]);

  /**
   * 前回の絞り込みを復元する。
   *
   * **描画中にlocalStorageを読んではいけない。** サーバー側には無い値なので、
   * サーバーが描いたHTMLと最初のクライアント描画が食い違い、ハイドレーションのずれになる。
   * マウント後に読んで、後から反映する（一瞬だけ既定の絞り込みが見えるのは許容する）。
   */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(filterStorageKey(groupId));
      if (raw) {
        const saved = JSON.parse(raw) as { status?: unknown; genres?: unknown };
        if (Array.isArray(saved.status)) {
          setStatusFilter(new Set(saved.status.filter(isGameStatus)));
        }
        if (Array.isArray(saved.genres)) {
          // そのグループに今あるジャンルだけを残す。ゲームが消えて存在しなくなった
          // ジャンルが選ばれたままだと、開いた瞬間に0件になって理由が分からない
          const available = new Set(games.flatMap((g) => g.genres));
          setGenreFilter(
            new Set(saved.genres.filter((g): g is string => typeof g === "string" && available.has(g)))
          );
        }
      }
    } catch {
      // 保存が壊れている／localStorageが使えない（プライベートモード等）。既定のまま進む
    }
    setRestored(true);
    // グループが変われば読み直す。gamesは初回の判定にだけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  /** 絞り込みを変えたら保存する。復元前に走らせると既定値で上書きしてしまう */
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(
        filterStorageKey(groupId),
        JSON.stringify({ status: [...statusFilter], genres: [...genreFilter] })
      );
    } catch {
      // 保存できなくても表示には影響しない（次に開くと既定に戻るだけ）
    }
  }, [restored, groupId, statusFilter, genreFilter]);

  const allGenres = Array.from(new Set(items.flatMap((g) => g.genres))).sort();

  const filteredGames = items.filter(
    (g) =>
      (statusFilter.size === 0 || statusFilter.has(g.status)) &&
      (genreFilter.size === 0 || g.genres.some((genre) => genreFilter.has(genre)))
  );

  const filterCount = statusFilter.size + genreFilter.size;

  // 選択済みならその項目だけ外し、未選択なら足す
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  }

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

  async function addGame(result: SteamResult) {
    const previous = items;
    const tempItem: GroupGameItem = {
      id: `temp-${result.appId}`,
      steamAppId: result.appId,
      title: result.name,
      coverUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${result.appId}/header.jpg`,
      status: "WISHLIST",
      genres: [],
      addedByName: "追加中…",
      interestedUsers: [],
    };
    // 追加は即座に画面に反映し、モーダルも閉じてしまう（往復を待たせない）
    setItems([tempItem, ...previous]);
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamAppId: result.appId,
          title: result.name,
          coverUrl: tempItem.coverUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "追加に失敗しました");
      }
      router.refresh();
    } catch (e) {
      setItems(previous);
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    }
  }

  async function changeStatus(gameId: string, status: GameStatus) {
    const previous = items;
    setItems(items.map((g) => (g.id === gameId ? { ...g, status } : g)));
    setUpdatingId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setItems(previous);
      setError("ステータスの更新に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeGame(gameId: string) {
    const previous = items;
    setItems(items.filter((g) => g.id !== gameId));
    setUpdatingId(gameId);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/games/${gameId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch {
      setItems(previous);
      setError("削除に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatusFilter(new Set())}
            aria-pressed={statusFilter.size === 0}
            className={chipButton(statusFilter.size === 0)}
          >
            すべて
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter((prev) => toggle(prev, s))}
              aria-pressed={statusFilter.has(s)}
              className={statusFilter.has(s) ? `${chipBase} ${STATUS_BADGE_CLASS[s]}` : chipButton(false)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {allGenres.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGenreFilter(new Set())}
            aria-pressed={genreFilter.size === 0}
            className={chipButton(genreFilter.size === 0)}
          >
            全ジャンル
          </button>
          {allGenres.map((g) => (
            <button
              key={g}
              onClick={() => setGenreFilter((prev) => toggle(prev, g))}
              aria-pressed={genreFilter.has(g)}
              className={chipButton(genreFilter.has(g))}
            >
              {translateGenre(g)}
            </button>
          ))}
        </div>
      )}

      {filterCount > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-sm text-steam-muted">
            {filterCount}件の条件で絞り込み中・{filteredGames.length}/{items.length}件
          </p>
          <button
            onClick={() => {
              setStatusFilter(new Set());
              setGenreFilter(new Set());
            }}
            className={textButton}
          >
            <X size={14} aria-hidden="true" /> 条件をクリア
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {filteredGames.length === 0 ? (
        <p className="mt-4 text-sm text-steam-muted">
          {items.length === 0
            ? "まだゲームが登録されていません。"
            : "条件に一致するゲームがありません。"}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filteredGames.map((game) => (
            <div
              key={game.id}
              data-testid="game-card"
              className="relative overflow-hidden rounded-xl bg-steam-surface transition hover:border-steam-blue"
            >
              <Link href={`/groups/${groupId}/games/${game.id}`}>
                <div className="relative h-24 w-full overflow-hidden bg-steam-panel">
                  {game.coverUrl ? (
                    <Image
                      src={game.coverUrl}
                      alt={game.title}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xs text-steam-muted">
                      No Image
                    </div>
                  )}
                </div>
                <div className="px-2 pt-2">
                  <p className="truncate font-display text-sm font-semibold text-steam-text">
                    {game.title}
                  </p>
                  <p className="truncate text-4xs text-steam-muted">
                    {game.addedByName}が追加
                  </p>
                  {!!game.playMs && game.playMs > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-3xs text-steam-blue" data-play-ms={game.playMs}>
                      <ActivityIcon kind="play.session" size={12} className="shrink-0" />
                      <span className="font-num">{formatPlayDuration(game.playMs)}</span>
                    </p>
                  )}
                  {game.genres.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {game.genres.slice(0, 2).map((g) => (
                        <span
                          key={g}
                          className="rounded-sm bg-steam-panel px-1 py-0.5 text-4xs text-steam-muted"
                        >
                          {translateGenre(g)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
              <div className="p-2">
                {/* 折り返せるようにしておく。スマホの2列だとカードは170px前後しかなく、「ねらってる」に文字を足したら
                    右端が切れて削除ボタンが見えなくなった（カードが overflow-hidden なので横スクロールにも出ない。B127） */}
                <div className="flex flex-wrap items-center justify-between gap-1">
                  {canEdit ? (
                    <select
                      value={game.status}
                      disabled={updatingId === game.id}
                      onChange={(e) => changeStatus(game.id, e.target.value as GameStatus)}
                      className={`${BUTTON_HEIGHT} rounded-lg border bg-steam-panel px-2 text-sm outline-none disabled:opacity-50 ${STATUS_BADGE_CLASS[game.status]}`}
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-lg border px-2 py-1 text-sm ${STATUS_BADGE_CLASS[game.status]}`}
                    >
                      {STATUS_LABEL[game.status]}
                    </span>
                  )}

                  {currentUserId && !game.id.startsWith("temp-") && (
                    <InterestButton
                      groupId={groupId}
                      gameId={game.id}
                      users={game.interestedUsers}
                      currentUserId={currentUserId}
                    />
                  )}
                </div>
              </div>
              {/* 削除は画像の右上に重ねる。ボタンを44pxにしたら、スマホの2列のカード（中の幅159px前後）では
                  「ねらってる」と同じ段に収まらず、はみ出していた（B127）。削除は編集者だけが使う、たまの操作 */}
              {canEdit && (
                <button
                  onClick={() => removeGame(game.id)}
                  disabled={updatingId === game.id}
                  className={`${ICON_BUTTON_SIZE} absolute right-1.5 top-1.5 inline-flex items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-danger disabled:opacity-50`}
                  aria-label="削除"
                  title="リストから削除"
                >
                  {updatingId === game.id ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl bg-steam-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-steam-text">
                ゲームをリストに追加
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className={ghostIconButton}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ゲーム名で検索"
                disabled={searching}
                className="flex-1 rounded-lg border border-steam-border bg-steam-bg px-3 py-2 text-xs text-steam-text outline-none focus:border-steam-blue disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-accent px-3 py-2 text-xs font-bold text-accent-ink disabled:opacity-40"
              >
                {searching ? <Spinner size={12} /> : <Search size={12} />}
                検索
              </button>
            </div>

            <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.appId}
                  onClick={() => addGame(r)}
                  className="flex items-center gap-3 rounded-lg bg-steam-panel p-2 text-left transition hover:border-steam-blue"
                >
                  <Image
                    src={r.thumbnail}
                    alt=""
                    width={64}
                    height={40}
                    className="h-10 w-16 flex-shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-steam-text">{r.name}</span>
                </button>
              ))}
              {searched && !searching && results.length === 0 && (
                <p className="text-2xs text-steam-muted">見つかりませんでした</p>
              )}
            </div>

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
