import { defineConfig } from "prisma/config";

/**
 * Prisma 7 keeps CLI connection config here (not in .env alone).
 *
 * The SQLite file lives in `db/fieldward.db`, resolved relative to this file.
 * Swapping to another database for production (e.g. a Neon Postgres adapter)
 * is a contained change: point `datasource.url` at the new database and swap
 * the adapter in `src/lib/db.ts`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: "file:./db/fieldward.db",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
