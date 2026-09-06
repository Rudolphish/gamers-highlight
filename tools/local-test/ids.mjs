import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const [admin, member, outsider] = await Promise.all([
  db.user.findUnique({ where: { email: "admin@example.com" } }),
  db.user.findUnique({ where: { email: "member@example.com" } }),
  db.user.findUnique({ where: { email: "outsider@example.com" } }),
]);
const group = await db.group.findFirst({ where: { name: "テストグループ" } });
const otherGroup = await db.group.findFirst({ where: { name: "部外者のグループ" } });
const album = await db.album.findFirst({ where: { title: "エルデンリング" } });
const otherAlbum = await db.album.findFirst({ where: { title: "部外者のアルバム" } });
// admin だけがアルバムメンバーのアルバム。member はグループの編集者だが、
// アルバムに招待されていないので VIEWER 止まり（改名の入口が出ないことの確認に使う）
const adminOnlyAlbum = await db.album.findFirst({ where: { title: "ゼルダの伝説" } });
const game = await db.groupGame.findFirst({ where: { groupId: group.id } });
const proposal = await db.groupGameProposal.findFirst({ where: { groupId: group.id } });
const invite = await db.groupInvite.findFirst({ where: { token: "test-invite-token-0001" } });
const outsiderPhoto = await db.photo.findFirst({ where: { uploaderId: outsider.id } });
const memberPhoto = await db.photo.findFirst({ where: { uploaderId: member.id } });
// 未分類（アルバム未所属）の写真。リアクションが拒否されることの確認に使う
const unclassifiedPhoto = await db.photo.findFirst({ where: { albumId: null } });
console.log(JSON.stringify({
  adminId: admin.id, memberId: member.id, outsiderId: outsider.id,
  groupId: group.id, otherGroupId: otherGroup.id,
  albumId: album.id, otherAlbumId: otherAlbum.id, adminOnlyAlbumId: adminOnlyAlbum.id,
  gameId: game.id, proposalId: proposal.id, inviteId: invite.id,
  inviteToken: "test-invite-token-0001",
  // スイートを流した後は消えていることがある（api-sweep が仕様確認で削除する）ので null 許容
  outsiderPhotoId: outsiderPhoto?.id ?? null, memberPhotoId: memberPhoto?.id ?? null,
  unclassifiedPhotoId: unclassifiedPhoto?.id ?? null,
}));
await db.$disconnect();
