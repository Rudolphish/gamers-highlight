// 総合テスト用のシードデータ。ローカルPostgres（5433）に投入する。
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // 既存を消す（順序は外部キー依存に従う）
  await db.groupGameProposalReaction.deleteMany();
  await db.groupGameProposal.deleteMany();
  await db.groupGameInterest.deleteMany();
  await db.groupGame.deleteMany();
  await db.groupInviteUse.deleteMany();
  await db.allowlistEntry.deleteMany();
  await db.groupInvite.deleteMany();
  await db.photo.deleteMany();
  await db.discordGameTag.deleteMany();
  await db.discordChannelMapping.deleteMany();
  await db.albumMember.deleteMany();
  await db.album.deleteMany();
  await db.groupMember.deleteMany();
  await db.group.deleteMany();
  await db.user.deleteMany();
  await db.errorReport.deleteMany();
  await db.externalGameCache.deleteMany();
  await db.apiUsage.deleteMany();
  await db.appSetting.deleteMany();

  const admin = await db.user.create({
    data: {
      email: "admin@example.com",
      name: "管理者ユーザー",
      provider: "discord",
      discordUserId: "100000000000000001",
    },
  });
  const member = await db.user.create({
    data: {
      email: "member@example.com",
      name: "一般メンバー",
      provider: "discord",
      discordUserId: "100000000000000002",
    },
  });
  const outsider = await db.user.create({
    data: {
      email: "outsider@example.com",
      name: "部外者",
      provider: "discord",
      discordUserId: "100000000000000003",
    },
  });

  for (const u of [admin, member, outsider]) {
    await db.allowlistEntry.create({
      data: { email: u.email, discordUserId: u.discordUserId, note: u.name },
    });
  }

  const group = await db.group.create({
    data: {
      name: "テストグループ",
      guildId: "900000000000000001",
      ownerId: admin.id,
      members: {
        create: [
          { userId: admin.id, role: "OWNER", acceptedAt: new Date() },
          { userId: member.id, role: "EDITOR", acceptedAt: new Date() },
        ],
      },
    },
  });

  // 部外者だけのグループ（他人のグループが見えないことの確認用）
  const otherGroup = await db.group.create({
    data: {
      name: "部外者のグループ",
      ownerId: outsider.id,
      members: { create: [{ userId: outsider.id, role: "OWNER", acceptedAt: new Date() }] },
    },
  });

  const album = await db.album.create({
    data: {
      title: "エルデンリング",
      description: "総合テスト用のアルバム",
      gameTitle: "ELDEN RING",
      steamAppId: 1245620,
      ownerId: admin.id,
      groupId: group.id,
      members: {
        create: [
          { userId: admin.id, role: "OWNER", acceptedAt: new Date() },
          { userId: member.id, role: "EDITOR", acceptedAt: new Date() },
        ],
      },
    },
  });

  const otherAlbum = await db.album.create({
    data: {
      title: "部外者のアルバム",
      ownerId: outsider.id,
      groupId: otherGroup.id,
      members: { create: [{ userId: outsider.id, role: "OWNER", acceptedAt: new Date() }] },
    },
  });

  // 並び替え（B27〜）の確認用。**4つの並び順がそれぞれ違う結果になるように仕込む。**
  // どれか2つが同じ順序になると、テストが通っても「その並びが効いている」証拠にならない。
  //
  //   更新順  : エルデンリング → ゼルダ → あつまれ
  //   新着順  : ゼルダ → あつまれ → エルデンリング
  //   名前順  : あつまれ(あ) → エルデンリング(エ) → ゼルダ(ゼ)
  //   写真順  : ゼルダ(3) → エルデンリング(2) → あつまれ(0)
  const zelda = await db.album.create({
    data: {
      title: "ゼルダの伝説",
      ownerId: admin.id,
      groupId: group.id,
      members: { create: [{ userId: admin.id, role: "OWNER", acceptedAt: new Date() }] },
    },
  });

  const animalCrossing = await db.album.create({
    data: {
      title: "あつまれ どうぶつの森",
      ownerId: member.id,
      groupId: group.id,
      members: { create: [{ userId: member.id, role: "OWNER", acceptedAt: new Date() }] },
    },
  });

  await db.photo.createMany({
    data: [
      {
        mediaType: "IMAGE",
        mediaUrl: "http://127.0.0.1:9100/gh-local/photos/shot1.png",
        uploaderId: admin.id,
        albumId: album.id,
        gameTitle: "ELDEN RING",
        capturedAt: new Date("2026-08-01T10:00:00Z"),
        sizeBytes: 1234,
        source: "MANUAL",
      },
      {
        mediaType: "VIDEO",
        mediaUrl: "http://127.0.0.1:9100/gh-local/photos/clip1.mp4",
        thumbnailUrl: "http://127.0.0.1:9100/gh-local/photos/clip1-thumb.png",
        durationSeconds: 30,
        uploaderId: member.id,
        albumId: album.id,
        gameTitle: "ELDEN RING",
        capturedAt: new Date("2026-08-02T10:00:00Z"),
        sizeBytes: 456789,
        source: "DISCORD",
        discordMessageId: "800000000000000001",
      },
      {
        // 未分類（アルバム未所属）
        mediaType: "IMAGE",
        mediaUrl: "http://127.0.0.1:9100/gh-local/photos/unsorted.png",
        uploaderId: admin.id,
        gameTitle: null,
        sizeBytes: 999,
        source: "DISCORD",
        discordMessageId: "800000000000000002",
      },
      {
        mediaType: "IMAGE",
        mediaUrl: "http://127.0.0.1:9100/gh-local/photos/outsider.png",
        uploaderId: outsider.id,
        albumId: otherAlbum.id,
        source: "MANUAL",
      },
      // ゼルダに3枚（「写真の多い順」でエルデンリングの2枚より上に来る）
      ...[1, 2, 3].map((n) => ({
        mediaType: "IMAGE",
        mediaUrl: `http://127.0.0.1:9100/gh-local/photos/zelda${n}.png`,
        uploaderId: admin.id,
        albumId: zelda.id,
        sizeBytes: 1000 + n,
        source: "MANUAL",
      })),
    ],
  });

  // createdAt / updatedAt を狙った値に固定する。
  // **Prismaからは書けない**（updatedAt は @updatedAt で自動管理、createdAt も
  //  @default(now()) が入る）ので、生SQLで上書きする。
  // ここが効いていないと「更新順」と「新着順」が同じ並びになり、
  // createdAt を渡し忘れていても気づけない。
  for (const [id, createdAt, updatedAt] of [
    [album.id, "2026-07-01", "2026-08-10"],
    [zelda.id, "2026-07-20", "2026-08-05"],
    [animalCrossing.id, "2026-07-10", "2026-08-01"],
  ]) {
    await db.$executeRaw`UPDATE albums SET "createdAt" = ${new Date(`${createdAt}T00:00:00Z`)}, "updatedAt" = ${new Date(`${updatedAt}T00:00:00Z`)} WHERE id = ${id}`;
  }

  const game = await db.groupGame.create({
    data: {
      groupId: group.id,
      steamAppId: 1245620,
      title: "ELDEN RING",
      coverUrl: "http://127.0.0.1:9100/gh-local/steam/1245620/header.jpg",
      status: "WISHLIST",
      genres: ["Action", "RPG"],
      albumId: album.id,
      addedById: admin.id,
      interests: { create: [{ userId: member.id }] },
    },
  });

  // フィルタの初期状態（プレイ中・気になるだけ出る）を確認するための状態違い。
  // app IDは flows が追加に使うもの（1091500 / 570 / 1174180 / 271590）と重ならないものにする。
  await db.groupGame.create({
    data: {
      groupId: group.id,
      steamAppId: 292030,
      title: "ウィッチャー3",
      status: "PLAYING",
      genres: ["RPG"],
      addedById: admin.id,
    },
  });
  await db.groupGame.create({
    data: {
      groupId: group.id,
      steamAppId: 379720,
      title: "DOOM（積みゲー）",
      status: "BACKLOG",
      genres: ["Action"],
      addedById: admin.id,
    },
  });
  await db.groupGame.create({
    data: {
      groupId: group.id,
      steamAppId: 220,
      title: "Half-Life 2（クリア済み）",
      status: "COMPLETED",
      genres: ["Action"],
      addedById: admin.id,
    },
  });

  const proposal = await db.groupGameProposal.create({
    data: {
      groupId: group.id,
      steamAppId: 271590,
      title: "Grand Theft Auto V",
      coverUrl: "http://127.0.0.1:9100/gh-local/steam/271590/header.jpg",
      proposedById: member.id,
      status: "PENDING",
      reactions: { create: [{ userId: member.id, type: "LIKE" }] },
    },
  });

  const invite = await db.groupInvite.create({
    data: {
      token: "test-invite-token-0001",
      groupId: group.id,
      role: "VIEWER",
      createdById: admin.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: 3,
      usedCount: 0,
    },
  });

  // 期限切れ／取り消し済みのリンク（弾かれることの確認用）
  await db.groupInvite.create({
    data: {
      token: "test-invite-expired",
      groupId: group.id,
      createdById: admin.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
      maxUses: 1,
    },
  });
  await db.groupInvite.create({
    data: {
      token: "test-invite-revoked",
      groupId: group.id,
      createdById: admin.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: 1,
      revokedAt: new Date(),
    },
  });

  console.log(
    JSON.stringify(
      {
        adminId: admin.id,
        memberId: member.id,
        outsiderId: outsider.id,
        groupId: group.id,
        otherGroupId: otherGroup.id,
        albumId: album.id,
        otherAlbumId: otherAlbum.id,
        gameId: game.id,
        proposalId: proposal.id,
        inviteToken: invite.token,
      },
      null,
      2
    )
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
