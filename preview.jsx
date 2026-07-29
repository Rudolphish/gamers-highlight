import { useState } from "react";
import {
  Home,
  Upload,
  Settings,
  Hash,
  Users,
  Play,
  Plus,
  X,
  ChevronLeft,
  Film,
  Image as ImageIcon,
} from "lucide-react";

// ---- Steam風カラートークン（任意値クラスに頼らずinline styleで確実に適用する）----
const C = {
  bg: "#1b2838",
  panel: "#171a21",
  surface: "#16202d",
  border: "#2f4359",
  text: "#c7d5e0",
  muted: "#8f98a0",
  blue: "#66c0f4",
  greenFrom: "#4c6b22",
  greenTo: "#a4d007",
  danger: "#eb4b4b",
};

// ---- モックデータ ----
const albums = [
  {
    id: "a1",
    title: "エルデンリング",
    tags: ["eldenring", "elden_ring", "er"],
    cover: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&q=60",
    count: 128,
    members: ["ゆうき", "たける", "みさき", "そう"],
  },
  {
    id: "a2",
    title: "Apex Legends",
    tags: ["apex"],
    cover: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=400&q=60",
    count: 64,
    members: ["ゆうき", "たける"],
  },
  {
    id: "a3",
    title: "未分類",
    tags: [],
    cover: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&q=60",
    count: 9,
    members: ["ゆうき", "たける", "みさき", "そう"],
  },
];

const media = [
  { id: "m1", type: "IMAGE", url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&q=70", uploader: "ゆうき", time: "2月前" },
  { id: "m2", type: "VIDEO", url: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&q=70", uploader: "たける", time: "2月前", duration: 24 },
  { id: "m3", type: "IMAGE", url: "https://images.unsplash.com/photo-1560253023-3ec5d502959f?w=600&q=70", uploader: "みさき", time: "3月前" },
  { id: "m4", type: "IMAGE", url: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&q=70", uploader: "そう", time: "3月前" },
  { id: "m5", type: "VIDEO", url: "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=600&q=70", uploader: "ゆうき", time: "4月前", duration: 18 },
  { id: "m6", type: "IMAGE", url: "https://images.unsplash.com/photo-1587573089734-599851ec3ecd?w=600&q=70", uploader: "たける", time: "4月前" },
];

const NAV = [
  { key: "home", label: "ホーム", icon: Home },
  { key: "album", label: "アルバム", icon: Film },
  { key: "upload", label: "アップロード", icon: Upload },
  { key: "settings", label: "タグ設定", icon: Settings },
];

const fontDisplay = { fontFamily: "'Rajdhani', 'Inter', sans-serif" };
const fontMono = { fontFamily: "'JetBrains Mono', monospace" };

function PrimaryButton({ children, onClick, className = "", full = false }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-3 py-2 text-xs font-bold ${full ? "w-full py-2.5 text-sm" : ""} ${className}`}
      style={{
        background: `linear-gradient(90deg, ${C.greenFrom}, ${C.greenTo})`,
        color: "#0e1b12",
        ...fontMono,
      }}
    >
      {children}
    </button>
  );
}

function CornerFrame({ children, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      {children}
      {[
        "left-1 top-1 border-l border-t",
        "right-1 top-1 border-r border-t",
        "bottom-1 left-1 border-b border-l",
        "bottom-1 right-1 border-b border-r",
      ].map((pos) => (
        <span
          key={pos}
          className={`pointer-events-none absolute h-2.5 w-2.5 ${pos}`}
          style={{ borderColor: `${C.blue}b3` }}
        />
      ))}
    </div>
  );
}

function TagChip({ tag, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px]"
      style={{ borderColor: C.border, background: C.surface, color: C.muted, ...fontMono }}
    >
      <Hash size={10} color={C.blue} />
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="ml-1" style={{ color: C.muted }}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function HomeScreen({ onOpenAlbum }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-wide sm:text-3xl" style={{ ...fontDisplay, color: C.text }}>
            マイアルバム
          </h1>
          <p className="mt-1 text-xs" style={{ ...fontMono, color: C.muted }}>
            4人のクルー・{albums.reduce((s, a) => s + a.count, 0)} クリップ収録
          </p>
        </div>
        <PrimaryButton className="flex w-fit items-center gap-1.5">
          <Plus size={14} className="inline -mt-0.5 mr-1" /> 新規アルバム
        </PrimaryButton>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {albums.map((a) => (
          <button key={a.id} onClick={() => onOpenAlbum(a)} className="group text-left">
            <CornerFrame className="overflow-hidden rounded-sm">
              <img src={a.cover} alt={a.title} className="h-32 w-full object-cover transition group-hover:scale-105" />
              <div
                className="absolute right-1.5 top-1.5 rounded-sm px-1.5 py-0.5 text-[10px]"
                style={{ background: `${C.bg}cc`, color: C.blue, ...fontMono }}
              >
                {a.count}
              </div>
            </CornerFrame>
            <p
              className="mt-2 truncate text-base font-semibold"
              style={{ ...fontDisplay, color: C.text }}
            >
              {a.title}
            </p>
            <div className="mt-1 flex h-6 flex-wrap items-center gap-1 overflow-hidden">
              {a.tags.length > 0 ? (
                <>
                  {a.tags.slice(0, 2).map((t) => (
                    <TagChip key={t} tag={t} />
                  ))}
                  {a.tags.length > 2 && (
                    <span
                      className="rounded-sm border px-2 py-1 text-[11px]"
                      style={{ borderColor: C.border, background: C.surface, color: C.muted, ...fontMono }}
                    >
                      +{a.tags.length - 2}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[11px]" style={{ ...fontMono, color: `${C.muted}99` }}>
                  タグ未設定
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AlbumScreen({ album, onBack }) {
  return (
    <div className="p-4 sm:p-6">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-xs"
        style={{ ...fontMono, color: C.muted }}
      >
        <ChevronLeft size={14} /> アルバム一覧に戻る
      </button>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl" style={{ ...fontDisplay, color: C.text }}>
            {album.title}
          </h1>
          <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ ...fontMono, color: C.muted }}>
            <Users size={12} />
            {album.members.join(" / ")}
          </div>
        </div>
        <button
          className="w-fit rounded-sm border px-3 py-2 text-xs"
          style={{ borderColor: C.border, color: C.text, ...fontMono }}
        >
          + メンバー招待
        </button>
      </div>

      <div
        className="mb-5 flex flex-wrap items-center gap-2 rounded-sm border p-3"
        style={{ borderColor: C.border, background: C.surface }}
      >
        <span className="text-[11px]" style={{ ...fontMono, color: C.muted }}>
          検知タグ:
        </span>
        {album.tags.length > 0 ? (
          album.tags.map((t) => <TagChip key={t} tag={t} />)
        ) : (
          <span className="text-[11px]" style={{ ...fontMono, color: `${C.muted}99` }}>
            未設定（未分類として保存されます）
          </span>
        )}
        <button className="ml-auto flex items-center gap-1 text-[11px]" style={{ ...fontMono, color: C.blue }}>
          <Plus size={12} /> タグ追加
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {media.map((m) => (
          <CornerFrame key={m.id} className="aspect-square overflow-hidden rounded-sm">
            <img src={m.url} alt="" className="h-full w-full object-cover" />
            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-between p-1.5"
              style={{ background: `linear-gradient(to top, ${C.bg}e6, transparent)` }}
            >
              <span className="text-[10px]" style={{ ...fontMono, color: `${C.text}e6` }}>
                {m.uploader}
              </span>
              {m.type === "VIDEO" && (
                <span
                  className="flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[9px] font-bold text-white"
                  style={{ background: `linear-gradient(90deg, ${C.greenFrom}, ${C.greenTo})` }}
                >
                  <Play size={8} fill="white" /> {m.duration}s
                </span>
              )}
            </div>
          </CornerFrame>
        ))}
      </div>
    </div>
  );
}

function UploadScreen() {
  const [mode, setMode] = useState("image");
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold sm:text-3xl" style={{ ...fontDisplay, color: C.text }}>
        アップロード
      </h1>
      <p className="mt-1 text-xs" style={{ ...fontMono, color: C.muted }}>
        画像、または30秒以内の動画クリップに対応
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {[
          { key: "image", label: "画像", icon: ImageIcon },
          { key: "video", label: "動画（〜30s）", icon: Film },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setMode(t.key)}
            className="flex items-center gap-1.5 rounded-sm border px-3 py-2 text-xs"
            style={{
              borderColor: mode === t.key ? C.blue : C.border,
              color: mode === t.key ? C.blue : C.muted,
              ...fontMono,
            }}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div
        className="mt-4 flex h-52 flex-col items-center justify-center rounded-sm border border-dashed"
        style={{ borderColor: C.border, background: C.surface }}
      >
        <Upload size={22} color={C.muted} />
        <p className="mt-2 text-xs" style={{ ...fontMono, color: C.muted }}>
          ここにファイルをドロップ、またはクリックして選択
        </p>
        <p className="mt-1 text-[10px]" style={{ ...fontMono, color: `${C.muted}99` }}>
          {mode === "image" ? "PNG / JPEG / WebP・最大15MB" : "MP4 / WebM / MOV・最大30MB・30秒まで"}
        </p>
      </div>

      {mode === "video" && (
        <div
          className="mt-3 flex items-center gap-2 rounded-sm border p-3 text-[11px]"
          style={{ borderColor: C.border, background: C.surface, color: C.muted, ...fontMono }}
        >
          サムネイル：<span style={{ color: C.blue }}>先頭フレーム自動抽出</span> / 任意画像を選択
        </div>
      )}

      <div className="mt-4">
        <label className="text-[11px]" style={{ ...fontMono, color: C.muted }}>
          ゲームタグ
        </label>
        <input
          placeholder="#eldenring"
          className="mt-1 w-full rounded-sm border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.border, background: C.bg, color: C.text, ...fontMono }}
        />
      </div>

      <div className="mt-5">
        <PrimaryButton full>アップロード</PrimaryButton>
      </div>
    </div>
  );
}

function SettingsScreen() {
  const [albumTags, setAlbumTags] = useState(() =>
    Object.fromEntries(albums.map((a) => [a.id, a.tags]))
  );
  const [selectedAlbumId, setSelectedAlbumId] = useState(albums[0].id);
  const [draft, setDraft] = useState("");

  const selectedAlbum = albums.find((a) => a.id === selectedAlbumId);
  const tags = albumTags[selectedAlbumId] ?? [];

  function addTag() {
    const t = draft.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    setAlbumTags((prev) => ({ ...prev, [selectedAlbumId]: [...tags, t] }));
    setDraft("");
  }

  function removeTag(t) {
    setAlbumTags((prev) => ({
      ...prev,
      [selectedAlbumId]: tags.filter((x) => x !== t),
    }));
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold sm:text-3xl" style={{ ...fontDisplay, color: C.text }}>
        タグ設定
      </h1>
      <p className="mt-1 text-xs" style={{ ...fontMono, color: C.muted }}>
        Discordに <span style={{ color: C.blue }}>#eldenring</span> のように投稿すると、初回は自動でアルバムが作られます
      </p>

      <div className="mt-5">
        <label className="text-[11px]" style={{ ...fontMono, color: C.muted }}>
          アルバムを選択
        </label>
        <select
          value={selectedAlbumId}
          onChange={(e) => setSelectedAlbumId(e.target.value)}
          className="mt-1 w-full rounded-sm border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.border, background: C.bg, color: C.text, ...fontMono }}
        >
          {albums.map((a) => (
            <option key={a.id} value={a.id} style={{ background: C.bg, color: C.text }}>
              {a.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 rounded-sm border p-4" style={{ borderColor: C.border, background: C.surface }}>
        <p className="text-lg font-semibold" style={{ ...fontDisplay, color: C.text }}>
          {selectedAlbum.title} のタグ
        </p>
        <p className="mt-1 text-[11px]" style={{ ...fontMono, color: C.muted }}>
          表記ゆれをここに追加すると同じアルバムに統合されます
        </p>
        <div className="mt-3 flex min-h-[2rem] flex-wrap gap-2">
          {tags.length > 0 ? (
            tags.map((t) => <TagChip key={t} tag={t} onRemove={() => removeTag(t)} />)
          ) : (
            <span className="text-[11px]" style={{ ...fontMono, color: `${C.muted}99` }}>
              タグ未設定（このアルバムは未分類扱いになります）
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="er_clip"
            className="flex-1 rounded-sm border px-3 py-1.5 text-xs outline-none"
            style={{ borderColor: C.border, background: C.bg, color: C.text, ...fontMono }}
          />
          <PrimaryButton onClick={addTag}>
            <Plus size={12} className="inline -mt-0.5 mr-1" /> 追加
          </PrimaryButton>
        </div>
      </div>

      <div className="mt-4 rounded-sm border p-4" style={{ borderColor: C.border, background: C.surface }}>
        <p className="text-lg font-semibold" style={{ ...fontDisplay, color: C.text }}>
          Discord連携
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs" style={{ ...fontMono, color: C.blue }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.blue }} /> 連携済み（@yuki_gg）
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [openAlbum, setOpenAlbum] = useState(null);

  return (
    <div className="flex h-full min-h-[640px] w-full" style={{ background: C.bg, color: C.text, fontFamily: "Inter, sans-serif" }}>
      {/* サイドナビ：常時アイコンのみ、ラベルはホバー時にツールチップ表示 */}
      <div
        className="flex w-16 flex-shrink-0 flex-col items-center gap-1 border-r py-4"
        style={{ borderColor: C.border, background: C.panel }}
      >
        <div className="mb-4 flex items-center justify-center px-2">
          <div
            className="h-7 w-7 flex-shrink-0 rounded-sm"
            style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.greenTo})` }}
          />
        </div>
        {NAV.map((n) => {
          const active = tab === n.key || (n.key === "album" && openAlbum);
          return (
            <button
              key={n.key}
              onClick={() => {
                setTab(n.key);
                if (n.key !== "album") setOpenAlbum(null);
              }}
              className="group relative flex items-center justify-center rounded-sm px-2.5 py-2 text-xs"
              style={{
                background: active ? C.surface : "transparent",
                color: active ? C.blue : C.muted,
                ...fontMono,
              }}
            >
              <n.icon size={16} />
              <span
                className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded-sm border px-2 py-1 text-[11px] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                style={{ borderColor: C.border, background: C.surface, color: C.text }}
              >
                {n.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* メイン */}
      <div className="flex-1 overflow-y-auto">
        {tab === "home" && (
          <HomeScreen
            onOpenAlbum={(a) => {
              setOpenAlbum(a);
              setTab("album");
            }}
          />
        )}
        {tab === "album" &&
          (openAlbum ? (
            <AlbumScreen album={openAlbum} onBack={() => setTab("home")} />
          ) : (
            <div className="p-6 text-xs" style={{ ...fontMono, color: C.muted }}>
              ホームからアルバムを選択してください
            </div>
          ))}
        {tab === "upload" && <UploadScreen />}
        {tab === "settings" && <SettingsScreen />}
      </div>
    </div>
  );
}
