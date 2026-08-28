import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires an explicit driver adapter for every database — including
 * SQLite. The adapter owns the connection; the SQLite file path is configured
 * in prisma.config.ts for the CLI and resolved here (relative to the project
 * root) for the runtime.
 *
 * Swapping to Postgres for production is a contained change: replace this
 * adapter (e.g. @prisma/adapter-pg) and update `datasource.url` in
 * prisma.config.ts. See DECISIONS.md.
 */
function createDb(): PrismaClient {
  const dbFile = path.join(process.cwd(), "db", "fieldward.db");
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
