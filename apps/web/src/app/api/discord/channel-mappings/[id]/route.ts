import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { hasGroupPermission } from "@/lib/permissions";

// DELETE /api/discord/channel-mappings/:id … 紐付け解除（自動生成されたアルバム自体は残す）
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const mapping = await db.discordChannelMapping.findUnique({ where: { id: params.id } });
  if (!mapping) return NextResponse.json({ error: "not found" }, { status: 404 });

  const group = await db.group.findUnique({ where: { guildId: mapping.guildId } });
  const allowed = group ? await hasGroupPermission(group.id, user.id, "EDITOR") : false;
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db.discordChannelMapping.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
