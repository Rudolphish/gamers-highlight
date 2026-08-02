import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@gamers-highlight/db";

const engineBinaryName = "query-engine-rhel-openssl-3.0.x";
const engineCandidates = [
  path.join(process.cwd(), "node_modules", "@gamers-highlight", "db", "generated", engineBinaryName),
  path.join(process.cwd(), ".next", "server", engineBinaryName),
  path.join(process.cwd(), ".next", "standalone", "server", engineBinaryName),
  path.join(process.cwd(), "generated", engineBinaryName),
  path.join(process.cwd(), "apps", "web", "generated", engineBinaryName),
  path.join(process.cwd(), "packages", "db", "generated", engineBinaryName),
  path.join(process.cwd(), ".prisma", "client", engineBinaryName),
];

function setPrismaEngineBinary() {
  if (process.env.PRISMA_QUERY_ENGINE_BINARY) {
    return;
  }

  for (const candidate of engineCandidates) {
    if (fs.existsSync(candidate)) {
      process.env.PRISMA_QUERY_ENGINE_BINARY = candidate;
      if (process.env.NODE_ENV !== "production") {
        console.debug(`[prisma] using query engine binary from ${candidate}`);
      }
      return;
    }
  }
}

setPrismaEngineBinary();

// Next.jsの開発時ホットリロードでPrismaClientが多重生成されるのを防ぐ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
