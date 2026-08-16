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
const game = await db.groupGame.findFirst({ where: { groupId: group.id } });
const proposal = await db.groupGameProposal.findFirst({ where: { groupId: group.id } });
const invite = await db.groupInvite.findFirst({ where: { token: "test-invite-token-0001" } });
const outsiderPhoto = await db.photo.findFirst({ where: { uploaderId: outsider.id } });
const memberPhoto = await db.photo.findFirst({ where: { uploaderId: member.id } });
console.log(JSON.stringify({
  adminId: admin.id, memberId: member.id, outsiderId: outsider.id,
  groupId: group.id, otherGroupId: otherGroup.id,
  albumId: album.id, otherAlbumId: otherAlbum.id,
  gameId: game.id, proposalId: proposal.id, inviteId: invite.id,
  inviteToken: "test-invite-token-0001",
  outsiderPhotoId: outsiderPhoto.id, memberPhotoId: memberPhoto.id,
}));
await db.$disconnect();
