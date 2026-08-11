import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { z } from "zod";

// 許可リストの登録内容。DiscordユーザーIDとメールのどちらか（or 両方）があればよい。
// Discordログインでは discordUserId、それ以外は email で照合される（lib/auth.ts の signIn）。
const entrySchema = z
  .object({
    // Discordのsnowflakeは17〜20桁の数字
    discordUserId: z
      .string()
      .trim()
      .regex(/^\d{17,20}$/, "DiscordユーザーIDは17〜20桁の数字です")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    email: z
      .string()
      .trim()
      .email("メールアドレスの形式が正しくありません")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    note: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.discordUserId || v.email, {
    message: "DiscordユーザーIDかメールアドレスのどちらかは必須です",
  });

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) return null;
  return session!.user!.email!;
}

// GET /api/allowlist … 許可リスト一覧（管理者のみ）
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const entries = await db.allowlistEntry.findMany({ orderBy: { createdAt: "asc" } });

  // 「登録したがまだ一度もログインしていない人」を画面で見分けられるようにする。
  // グループへの招待は登録済みUserからしか選べないため、この状態のままだと招待できない。
  const users = await db.user.findMany({ select: { email: true, discordUserId: true } });
  const knownEmails = new Set(users.map((u) => u.email).filter(Boolean));
  const knownDiscordIds = new Set(users.map((u) => u.discordUserId).filter(Boolean));

  return NextResponse.json({
    entries: entries.map((e) => ({
      ...e,
      signedIn:
        (e.email !== null && knownEmails.has(e.email)) ||
        (e.discordUserId !== null && knownDiscordIds.has(e.discordUserId)),
    })),
  });
}

// POST /api/allowlist … 許可リストに追加（管理者のみ）
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = entrySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "入力内容が正しくありません" },
      { status: 400 }
    );
  }

  const existing = await db.allowlistEntry.findFirst({
    where: {
      OR: [
        parsed.data.discordUserId ? { discordUserId: parsed.data.discordUserId } : undefined,
        parsed.data.email ? { email: parsed.data.email } : undefined,
      ].filter(Boolean) as { discordUserId?: string; email?: string }[],
    },
  });
  if (existing) {
    return NextResponse.json({ error: "既に登録されています" }, { status: 409 });
  }

  const entry = await db.allowlistEntry.create({
    data: {
      discordUserId: parsed.data.discordUserId ?? null,
      email: parsed.data.email ?? null,
      note: parsed.data.note || null,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
