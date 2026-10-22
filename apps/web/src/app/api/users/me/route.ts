import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { z } from "zod";
import { THEME_COLOR_IDS } from "@/lib/themeColors";

// 表示名とテーマの色は別々に保存できる（プロフィールの画面は、色を選んだ瞬間に色だけを送る）
const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    themeColor: z.enum(THEME_COLOR_IDS).optional(),
  })
  .refine((v) => v.name !== undefined || v.themeColor !== undefined, { message: "Nothing to update" });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ここは getCurrentUser() で済ませられない。返すのが name を含むプロフィールで、
  // セッションのトークンの名前は、PATCH で改名しても画面がセッションの更新を頼むまで古いままだから
  // （プロフィールの画面は頼むが、他の端末のトークンは次にログインするまで古い。lib/auth.ts）。表示名は必ずDBから読む。
  const user = await db.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, themeColor: true },
  });

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ user });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: { name: parsed.data.name, themeColor: parsed.data.themeColor },
      select: { id: true, name: true, email: true, themeColor: true },
    });

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
