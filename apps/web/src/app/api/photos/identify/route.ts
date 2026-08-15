import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveGamesByAppId, scopeForUser } from "@/lib/gameIdentify";
import { dbErrorResponse } from "@/lib/dbError";

// POST /api/photos/identify … スクショのファイル名から読み取ったapp IDを、
// 表示できるゲーム名と「そのゲームのアルバムが既にあるか」に変える。
// body: { appIds: number[] }
//
// アップロード画面がファイル名を解析した後に1回だけ呼ぶ。ファイル本体は送らない。
// 判定そのものは lib/gameIdentify.ts にあり、Discord取り込みと共通。

const MAX_APP_IDS = 20;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.appIds) ? body.appIds : [];
  const appIds: number[] = [
    ...new Set(raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)),
  ].slice(0, MAX_APP_IDS);

  if (appIds.length === 0) return NextResponse.json({ results: [] });

  try {
    const results = await resolveGamesByAppId(appIds, scopeForUser(user.id));
    return NextResponse.json({ results });
  } catch (e) {
    return dbErrorResponse("photos:identify", e);
  }
}
