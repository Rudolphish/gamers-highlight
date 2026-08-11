import { AlertCircle } from "lucide-react";

// セクション単位の取得失敗表示。数字が出ないこと自体より
// 「なぜ出ないか」の方が管理者には必要なので、理由をそのまま出す。
export function SectionError({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-sm border border-[#eb4b4b]/40 bg-steam-panel p-3">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-[#eb4b4b]" />
      <div className="min-w-0">
        <p className="font-mono text-3xs text-steam-text">取得できませんでした</p>
        <p className="mt-0.5 break-words font-mono text-4xs text-steam-muted">{message}</p>
      </div>
    </div>
  );
}
