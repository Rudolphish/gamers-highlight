/**
 * 許可リスト（誰がこのアプリにログインできるか）を編集できる管理者の判定。
 *
 * ロール用のカラムを増やす代わりに環境変数`ADMIN_EMAILS`（カンマ区切り）で持つ。
 * 「許可リストに載っている人なら誰でも編集できる」にすると、メンバーの1人が
 * 第三者を招き入れられてしまい、招待制の意味が薄れるため管理者を分けている。
 *
 * 未設定なら誰も管理者ではない（フェイルクローズ）。設定画面側でその旨を表示する。
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** ADMIN_EMAILSが未設定＝管理UIを誰も使えない状態かどうか（案内文の出し分け用） */
export function isAdminConfigured(): boolean {
  return adminEmails().length > 0;
}
