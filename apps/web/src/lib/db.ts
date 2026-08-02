import { PrismaClient } from "@gamers-highlight/db";

// Next.jsの開発時ホットリロードでPrismaClientが多重生成されるのを防ぐ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
