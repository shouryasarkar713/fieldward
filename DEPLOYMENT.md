# Running and hosting Fieldward

This guide covers three things: getting the project running on your machine, putting it on GitHub, and hosting it — with the trade-offs of each hosting option spelled out, because the default database (a SQLite file) changes what "hosting" means on serverless platforms.

**The one thing to know up front:** the app stores everything in a single SQLite file at `db/fieldward.db`. Zero configuration, zero environment variables, works offline. That file is the only state the app has — which is why the hosting choice below is mostly a decision about where that state lives.

---

## 1. Running it locally

### Prerequisites

- **Node.js 20.19 or newer** (22 LTS recommended) — check with `node -v`
- npm 10+ (bundled with Node) or Bun 1.1+
- That's it. No API keys, no services. Weather data comes from Open-Meteo (keyless), product photos from the Unsplash CDN.

### Steps

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall).
npm install

# 2. Database setup — SKIP this if your copy already contains db/fieldward.db
#    with the gear library in it (the shipped file is pre-seeded, 28 items).
#    Only needed after a git clone without the db file, or after `npm run db:reset`:
npm run db:migrate   # create db/fieldward.db from prisma/migrations
npm run db:seed      # stock the gear library (idempotent)

# 3. Start the dev server
npm run dev          # → http://localhost:3000
```

If your download included `node_modules/` or `.next/`, you can keep them (faster start) or delete them and let step 1 rebuild everything — both are fine.

### Try the production build locally

```bash
npm run build        # migrate + seed (both idempotent) + compile
npm start            # → http://localhost:3000 (production server)
```

### Seeing the agent half of the demo

The human side (dragging cards, editing the brief, locking the plan) works in any browser. The agent side — the fourteen WebMCP tools — requires a browser (or browser extension) that exposes `document.modelContext`. In a plain browser the board simply works human-only; the tools never register. See the [WebMCP explainer](https://webmcp.io/) for current browser support.

### Running the verification harnesses

With the dev server running (`npm run dev` in one terminal):

```bash
npx tsx scripts/verify-mcp.ts    # 136 assertions over every tool's happy + error paths
npx tsx scripts/verify-loop.ts   # 45 assertions: the full human+agent collaboration loop
bash  scripts/browser-e2e.sh     # 39 browser checks (needs `npm i -g agent-browser` and
                                 #  a browser exposing document.modelContext)
```

The first two drive the tool layer in-process over HTTP and run anywhere. The browser harness additionally needs the agent-browser CLI and a WebMCP-capable browser; on a machine without one, the first two still cover the entire tool surface.

### Useful npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 (Turbopack) |
| `npm run build` | Migrate + seed + production build |
| `npm start` | Serve the production build on :3000 |
| `npm run db:migrate` | Apply `prisma/migrations` to the SQLite file |
| `npm run db:seed` | Stock the gear library (skips if already stocked; `FORCE_SEED=1` to wipe and reseed) |
| `npm run db:reset` | Drop everything and re-apply migrations (run `npm run db:seed` after) |
| `npm run db:generate` | Regenerate the Prisma client after editing the schema |

---

## 2. Put it on GitHub first

All hosting options below deploy from a Git repository, so start there:

```bash
git init
git add .
git commit -m "Fieldward: trip planning board with WebMCP agent tools"
git branch -M main
git remote add origin https://github.com/<your-username>/fieldward.git
git push -u origin main
```

`node_modules/`, `.next/`, `.env`, and logs are gitignored. The seeded `db/fieldward.db` **is** committed on purpose — a fresh clone runs with zero setup.

---

## 3. Hosting on Vercel — two ways

Vercel runs apps as serverless functions: the filesystem is read-only except `/tmp`, and every instance starts cold. A SQLite file can ride along fine as *read-only* data, but **writes cannot persist** on serverless. `next.config.ts` already accounts for this — so you have a choice:

### Option A — deploy exactly as-is (demo mode, zero changes)

`next.config.ts` bundles `db/fieldward.db` into every serverless function (`outputFileTracingIncludes`) and keeps the native SQLite driver external (`serverExternalPackages`). Vercel's default build command runs `npm run build`, which migrates, seeds, and bundles the file.

1. Push the repo to GitHub (above).
2. On [vercel.com](https://vercel.com): **Add New → Project → Import** your repo.
3. Framework preset: **Next.js** (auto-detected). Leave Build Command, Install Command, and Root Directory at their defaults.
4. Click **Deploy**.

You get a fully working URL: the gear library is there, the board works, weather works, the export works. One caveat, and it's the whole trade-off:

> **Writes are ephemeral.** Board changes, briefs, and proposals live only in the instance that accepted them. A cold start resets to the seeded state, and two concurrent visitors may land on different instances with independent boards. Perfect for a live demo or a portfolio link; wrong for anything where the data matters.

### Option B — Vercel + Neon Postgres (persistent data, recommended for real use)

The swap is deliberately contained (it's why the data layer goes through a driver adapter — see DECISIONS.md entry 1). Three small file edits, one database, one environment variable.

**1. Create the database.** On [neon.tech](https://neon.tech) (free tier is fine): create a project, copy the **pooled** connection string (`postgresql://...-pooler...`). Set it aside — you'll use it as `DATABASE_URL`.

**2. Swap the adapter.**

```bash
npm uninstall @prisma/adapter-better-sqlite3
npm install @prisma/adapter-pg
```

**3. Point the Prisma CLI at it — `prisma.config.ts`:**

```ts
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./db/fieldward.db",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
```

(The fallback keeps plain local SQLite working whenever `DATABASE_URL` is unset.)

**4. Switch the schema's provider — `prisma/schema.prisma`:**

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
}
```

**5. Recreate the migration history.** The existing migration files are written in SQLite dialect and can't apply to Postgres, so regenerate them against the real database:

```bash
rm -rf prisma/migrations
DATABASE_URL="postgresql://…your-neon-string…" npx prisma migrate dev --name init
```

This creates a fresh `prisma/migrations/…_init/` folder, applies it to Neon, and regenerates the Prisma client. Commit the new folder.

**6. Swap the runtime adapter — `src/lib/db.ts`:**

```ts
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

function createDb(): PrismaClient {
  if (process.env.DATABASE_URL != null) {
    // Production: hosted Postgres (Neon) through the pg driver adapter.
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  // Local default: the checked-in SQLite file.
  const dbFile = path.join(process.cwd(), "db", "fieldward.db");
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbFile}` }) });
}
```

(The caching logic at the bottom of the file stays as-is.)

**7. Same swap in `prisma/seed.ts`** — it builds its own client, so apply the same conditional:

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

// inside the script, replace the single adapter line with:
const adapter =
  process.env.DATABASE_URL != null
    ? new PrismaPg({ connectionString: process.env.DATABASE_URL })
    : new PrismaBetterSqlite3({ url: `file:${path.join(process.cwd(), "db", "fieldward.db")}` });
const prisma = new PrismaClient({ adapter });
```

**8. Update `next.config.ts`:** remove the `outputFileTracingIncludes` block (no SQLite file to bundle) and change `serverExternalPackages` to `["@prisma/adapter-pg", "pg"]`.

**9. Seed Postgres once** (local terminal, against Neon):

```bash
DATABASE_URL="postgresql://…your-neon-string…" npm run db:seed
```

**10. Deploy.** Import the repo on Vercel as in Option A, then before deploying add the environment variable:

- `DATABASE_URL` = your Neon pooled connection string

(Settings → Environment Variables; apply to Production, Preview, and Development.) The default build command (`npm run build`) then runs `prisma migrate deploy` (no-op after step 5) + `prisma db seed` (no-op after step 9, it's idempotent) + `next build` against the real database. **Data now persists across instances and cold starts.**

**Local development after the swap:** unchanged by default (unset `DATABASE_URL` → local SQLite). To develop against Postgres too, put the connection string in `.env.local` (gitignored).

> **Variant — Turso instead of Neon:** Turso keeps the SQLite dialect, so the existing migration SQL applies as-is (`cat prisma/migrations/*/migration.sql | turso db shell <your-db>` after creating it), and the runtime swap is `@prisma/adapter-libsql` (`new PrismaLibSQL({ url, authToken })` with `DATABASE_URL` + `DATABASE_AUTH_TOKEN`). The reason this guide leads with Neon: the Prisma CLI speaks Postgres natively, so `migrate deploy` and the whole build pipeline work unchanged on Vercel — with Turso, migrations are applied through Turso's own shell instead.

---

## 4. Hosting without any code changes — Railway, Render, Fly.io

These platforms run your app as a long-lived container/VM with a **persistent disk**, which is exactly what a SQLite file needs. Nothing in the repo changes; you only mount a volume where the database lives.

### Railway (simplest)

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
2. Railway detects Next.js and runs `npm install`, `npm run build`, `npm start` automatically. The build command already migrates + seeds.
3. Add the volume so the database survives restarts and redeploys: **Settings → Volumes → New Volume**, mount path **`/app/db`** (where the app resolves `db/fieldward.db`).
4. Open the generated `…up.railway.app` URL.

### Render

1. [render.com](https://render.com) → **New → Web Service** → connect the repo.
2. Build command: `npm install && npm run build` — Start command: `npm start`.
3. Add a **Persistent Disk** mounted at `/opt/render/project/src/db` (needs a paid instance; disks aren't available on the free tier).
4. Deploy. Note the caveat below.

### Fly.io

1. `fly launch` from the repo root (it generates a Node config), then `fly volumes create data --size 1`.
2. In `fly.toml`, add:

```toml
[mounts]
  source = "data"
  destination = "/app/db"
```

3. `fly deploy`.

> **Single-instance caveat for all three:** SQLite allows one writer. One container + one volume = fine for a demo, a team, or moderate traffic — it is not a multi-region horizontally-scaled setup. When you outgrow it, do the Neon swap from Option B; the app code barely notices.

---

## 5. Environment variables reference

| Variable | Required? | Used by |
| --- | --- | --- |
| *(none)* | — | The default SQLite setup needs zero configuration |
| `DATABASE_URL` | Only after the Postgres swap | `src/lib/db.ts`, `prisma/seed.ts`, `prisma.config.ts` (CLI), set in Vercel/Railway/Render dashboard |
| `DATABASE_AUTH_TOKEN` | Only after the Turso variant | `src/lib/db.ts`, `prisma/seed.ts` |

Weather (Open-Meteo) and product images (Unsplash CDN) are keyless — nothing to configure. `next.config.ts` already whitelists `images.unsplash.com` for `next/image` optimization.

---

## 6. Troubleshooting

**`prisma generate` / client errors after pulling changes** — run `npm run db:generate` (or just `npm install`; postinstall does it).

**Port 3000 already in use** — `next dev -p 3000` is fixed in the dev script; stop the other process or run `npx next dev -p 3001` manually.

**Weather chip says "unavailable — try again in a moment"** — Open-Meteo's anonymous tier is IP-rate-limited. On a shared IP (office, CI, some cloud egress) the quota can be exhausted; on a normal connection the forecast and seasonal-average states return real data. The three states and their labels are contract-tested in `scripts/verify-mcp.ts` regardless.

**`better-sqlite3` native build failures on `npm install`** — rare (prebuilt binaries cover standard platforms). If it hits you: ensure you're on Node 20.19+/22 LTS; on Windows, use the LTS Node (not the newest) so a prebuild matches; worst case, build tools (`build-essential` / Xcode CLT) let node-gyp compile it.

**Vercel deploy works but data resets** — that's Option A's documented behavior (ephemeral writes). Move to Option B.

**Agent tools don't appear** — the browser doesn't expose `document.modelContext`. The board still works fully for humans; use a WebMCP-capable browser or client to see the agent surface.

**Want a truly clean slate locally** — `npm run db:reset && npm run db:seed`, or just delete `db/fieldward.db` and re-run migrate + seed.
