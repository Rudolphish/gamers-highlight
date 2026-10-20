import {
  Ban,
  Bookmark,
  Camera,
  Circle,
  Eraser,
  Eye,
  EyeOff,
  FolderPlus,
  FolderX,
  Gamepad2,
  Heart,
  HeartOff,
  ListPlus,
  PartyPopper,
  PenLine,
  RefreshCw,
  Trash2,
  Undo2,
  UserPlus,
  Vote,
  type LucideIcon,
} from "lucide-react";
import type { ActivityKind } from "@/lib/activityLog";

// 活動の記録の種類ごとのアイコン（デザイン刷新の段階2）。
// 以前は絵文字（lib/activityLog.ts の ACTIVITY_EMOJI）を画面にそのまま出していて、ほかの場所の線のアイコンと混ざっていた。
// 絵文字の表は Discord の通知と管理画面の週次まとめで今も使うので残してある。画面に出すのはこちら。
// 遊んだ記録（"play.session"）は活動の記録の種類ではないが、同じ一覧に並ぶのでここで扱う
const ICONS: Record<ActivityKind | "play.session", LucideIcon> = {
  "photo.created": Camera,
  "photo.deleted": Trash2,
  "photo.description_set": PenLine,
  "photo.description_cleared": Eraser,
  "photo.reaction_added": Heart,
  "photo.reaction_removed": HeartOff,
  "album.created": FolderPlus,
  "album.deleted": FolderX,
  "game.added": ListPlus,
  "game.status_changed": RefreshCw,
  "game.removed": Ban,
  "game.interest_added": Eye,
  "game.interest_removed": EyeOff,
  "proposal.created": Bookmark,
  "proposal.voted": Vote,
  "proposal.vote_removed": Undo2,
  "proposal.accepted": PartyPopper,
  "proposal.withdrawn": Trash2,
  "member.joined": UserPlus,
  "play.session": Gamepad2,
};

/**
 * 種類のアイコン。飾りなので読み上げからは外す（隣に必ず文字の説明がある）。
 * `data-kind` はテストがどの種類のアイコンかを見分けるための印（絵文字の文字を見ていたテストの代わり）
 */
export function ActivityIcon({ kind, size = 16, className }: { kind: string; size?: number; className?: string }) {
  const Icon = ICONS[kind as keyof typeof ICONS] ?? Circle;
  return <Icon size={size} className={className} aria-hidden="true" data-kind={kind} />;
}
