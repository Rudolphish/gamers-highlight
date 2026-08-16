import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  guildId: z
    .string()
    .trim()
    .regex(/^\d{15,25}$/, "guildId must be a Discord snowflake ID")
    .optional()
    .or(z.literal("")),
});

// GET /api/groups … 自分が所有/参加しているグループ一覧
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const groups = await db.group.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ groups });
}

// POST /api/groups … グループ作成
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const guildId = parsed.data.guildId ? parsed.data.guildId : undefined;
  if (guildId) {
    const existing = await db.group.findUnique({ where: { guildId } });
    if (existing) {
      return NextResponse.json(
        { error: "このDiscordサーバーは既に別のグループと紐付いています" },
        { status: 409 }
      );
    }
  }

  const group = await db.group.create({
    data: {
      name: parsed.data.name,
      guildId,
      ownerId: user.id,
    },
  });

  return NextResponse.json({ group }, { status: 201 });
}
