import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ChannelMappingManager } from "@/components/settings/ChannelMappingManager";
import { SettingsNav } from "@/components/settings/SettingsNav";

// チャンネルマッピング管理画面：
// 「#elden-ring」チャンネル→「エルデンリング」のようにチャンネルとゲーム/アルバムを紐付け設定
export default async function ChannelMappingPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user?.email
    ? await db.user.findUnique({ where: { email: session.user.email } })
    : null;
  if (!user) return null;

  const groups = await db.group.findMany({
    where: {
      guildId: { not: null },
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, guildId: true },
  });

  return (
    <main className="p-4 sm:p-6">
      <h1 className="font-display text-2xl font-bold text-steam-text sm:text-3xl">
        チャンネル連携設定
      </h1>
      <SettingsNav />

      <ChannelMappingManager
        groups={groups.map((g) => ({ id: g.id, name: g.name, guildId: g.guildId as string }))}
      />
    </main>
  );
}
