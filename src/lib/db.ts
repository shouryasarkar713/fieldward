import fs from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires an explicit driver adapter for every database — including
 * SQLite. The adapter owns the connection; the SQLite file path is configured
 * in prisma.config.ts for the CLI and resolved here (relative to the project
 * root) for the runtime.
 *
 * On Vercel / serverless runtimes, the deployment root is read-only (EROFS).
 * The bundled, seeded database is copied to `/tmp/fieldward.db` on cold start
 * so that board mutations, proposals, and brief saves can write freely.
 */
function getDatabasePath(): string {
  const bundledDb = path.join(process.cwd(), "db", "fieldward.db");
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    const tmpDb = path.join("/tmp", "fieldward.db");
    if (!fs.existsSync(tmpDb)) {
      try {
        if (fs.existsSync(bundledDb)) {
          fs.copyFileSync(bundledDb, tmpDb);
        }
      } catch (err) {
        console.error("[fieldward:db] Failed to copy bundled database to /tmp:", err);
      }
    }
    return tmpDb;
  }

  return bundledDb;
}

function createDb(): PrismaClient {
  const dbFile = getDatabasePath();
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbFile}` });
  return new PrismaClient({ adapter });
}

type PrismaGlobal = {
  fieldwardPrisma?: PrismaClient;
  /** Identity of the PrismaClient constructor that produced the cached instance. */
  fieldwardPrismaCtor?: unknown;
};

const globalForPrisma = globalThis as unknown as PrismaGlobal;

/**
 * Reuse the cached client only when it was built from the SAME generated
 * PrismaClient constructor. `prisma migrate dev` regenerates the client on
 * schema changes — the new module's constructor has a new identity, so the
 * stale instance (which doesn't know the new columns) is discarded and
 * rebuilt instead of poisoning the running dev server until a manual restart.
 */
export const db =
  globalForPrisma.fieldwardPrisma !== undefined && globalForPrisma.fieldwardPrismaCtor === PrismaClient
    ? globalForPrisma.fieldwardPrisma
    : createDb();

globalForPrisma.fieldwardPrisma = db;
globalForPrisma.fieldwardPrismaCtor = PrismaClient;
