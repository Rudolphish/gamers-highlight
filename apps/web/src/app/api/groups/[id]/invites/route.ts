import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";
import { generateInviteToken, DEFAULT_EXPIRY_HOURS } from "@/lib/groupInvites";

// GET/POST /api/groups/:id/invites … グループの招待リンクの一覧・発行
//
// **OWNERのみ。** このリンクは許可リストへの登録を代行する（＝アプリにログインできる人を増やす）
// ため、既存のメンバー招待（同じくOWNER限定）と同じ権限に揃えている。
const MAX_EXPIRY_HOURS = 24 * 30;
const MAX_USES = 20;

async function requireOwner(groupId: string) {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!actor) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const allowed = await hasGroupPermission(groupId, actor.id, "OWNER");
  if (!allowed) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };

  return { actor };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireOwner(params.id);
  if (error) return error;

  const invites = await db.groupInvite.findMany({
    where: { groupId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { name: true, email: true } },
      uses: {
        orderBy: { usedAt: "asc" },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });

  return NextResponse.json({ invites });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { actor, error } = await requireOwner(params.id);
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  // OWNERは招待リンクからは付与しない（オーナーの委譲は明示的な操作であるべき）
  const role = body.role === "EDITOR" ? "EDITOR" : "VIEWER";

  const hours = Number(body.expiresInHours);
  const expiresInHours =
    Number.isFinite(hours) && hours > 0 && hours <= MAX_EXPIRY_HOURS ? hours : DEFAULT_EXPIRY_HOURS;

  const uses = Number(body.maxUses);
  const maxUses = Number.isInteger(uses) && uses >= 1 && uses <= MAX_USES ? uses : 1;

  const invite = await db.groupInvite.create({
    data: {
      token: generateInviteToken(),
      groupId: params.id,
      role,
      createdById: actor!.id,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      maxUses,
    },
  });

  return NextResponse.json({ invite }, { status: 201 });
}
