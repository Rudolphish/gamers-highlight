import { NextResponse } from "next/server";

/**
 * Prismaの例外を、画面にそのまま出して意味が通る日本語にする。
 *
 * **APIが素の500を返すと、画面には「失敗しました」しか出せない。**
 * スキーマを変えたのに `prisma db push` を忘れたケースが特に分かりにくく、
 * 実際に「発行に失敗しました」だけを見て原因を追う羽目になった。
 */
export function describeDbError(e: unknown): string {
  const code = (e as { code?: string })?.code;

  // P2021: テーブルが無い / P2022: 列が無い（どちらも push 忘れ）
  if (code === "P2021" || code === "P2022") {
    return "データベースにテーブルまたは列がありません。`pnpm --filter @gamers-highlight/db exec prisma db push` を実行してください。";
  }
  if (code === "P2003") {
    return "参照先のデータが見つかりません。";
  }
  if (code === "P2002") {
    return "同じ内容が既に登録されています。";
  }

  const message = e instanceof Error ? e.message : String(e);
  return message.split("\n").filter(Boolean).pop()?.slice(0, 200) || "不明なエラー";
}

/**
 * 例外をログに残しつつ、理由を含む500を返す。
 * tagは本番のログ（Vercel）から追うための目印。
 */
export function dbErrorResponse(tag: string, e: unknown) {
  console.error(`[${tag}]`, e);
  return NextResponse.json({ error: describeDbError(e) }, { status: 500 });
}
