// アカウントの丸に出す1文字。日本語の名前（「けんた」）は最初の1文字、英字は大文字にする。
// 名前がまだ読めていないとき（セッションの読み込み中）は空のまま丸だけ出す
export function accountInitial(name: string | null | undefined): string {
  const first = Array.from((name ?? "").trim())[0] ?? "";
  return first.toUpperCase();
}
