import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const sourceEnginePath = path.join(repoRoot, "packages", "db", "generated", "query-engine-rhel-openssl-3.0.x");

if (!existsSync(sourceEnginePath)) {
  console.warn(`[prisma-engine] Source engine not found at ${sourceEnginePath}`);
  process.exit(0);
}

const targetRoots = [repoRoot, webRoot];
const targetSubdirs = [".next", ".next/server", ".next/server/app", ".next/server/chunks", ".next/standalone/server"];

for (const root of targetRoots) {
  for (const subdir of targetSubdirs) {
    const targetDir = path.join(root, subdir);
    mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(sourceEnginePath));
    copyFileSync(sourceEnginePath, targetPath);
  }
}

console.log(`[prisma-engine] Copied engine binary to Next.js output directories`);
