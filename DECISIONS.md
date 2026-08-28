# DECISIONS.md

Judgment calls made while building Fieldward, logged as they were decided. Each entry: the situation, the call, and why.

---

## 1. Prisma 7 requires an explicit driver adapter — even for SQLite

**Situation:** The spec anticipated this ("if the spec conflicts with current library reality, fix sensibly"). In the current Prisma major, `new PrismaClient()` with no adapter fails at runtime; the client no longer opens its own connections.

**Call:** Use `@prisma/adapter-better-sqlite3`, constructed in `src/lib/db.ts` with the resolved path to `db/fieldward.db`. CLI-side connection config lives in `prisma.config.ts` (the `.env`-only convention is gone in Prisma 7). The generated client is emitted to `src/generated/prisma` so imports survive clean reinstalls.

**Why this shape:** The spec asked that "swapping to Postgres is a contained change." With the adapter pattern, a production swap is: replace the adapter in `src/lib/db.ts`, change `datasource.url` in `prisma.config.ts`. Nothing else moves.

## 2. `db/fieldward.db` is committed to git

**Call:** The seeded SQLite file ships in the repository.

**Why:** A hackathon judge should be able to clone, `npm install`, `npm run dev`, and see a full store immediately. The file is ~60 KB. Migrations + an idempotent seed exist for anyone who wants to rebuild from scratch (`npm run db:reset`).

## 3. Seed is idempotent, and `npm run build` re-seeds safely

**Situation:** The build script runs `prisma migrate deploy && prisma db seed && next build` (so a fresh clone/CI/Deploy gets a stocked catalog). A naive seed would wipe carts on every build.

**Call:** `prisma/seed.ts` skips when the catalog already has products; `FORCE_SEED=1` wipes and reseeds explicitly.

## 4. Cart lines are attributed, never merged

**Situation:** The same product added by the human and by the agent could be merged into one line (classic cart behavior) — but that would erase the demo's whole point: *who added what*.

**Call:** A cart line is unique by (session, product, addedBy). Human and agent lines for the same product sit separately, each tagged "Added by you" / "Added by agent" with a lucide icon. The API and the UI both honor this.

## 5. `addedBy: "agent"` is hardcoded in the tool, never trusted from input

**Call:** The `add_to_cart` tool stamps `addedBy: "agent"` in the tool layer; the field is not accepted from tool input. The API route itself still accepts an `addedBy` value (the UI sends `"human"`), because the route is shared infrastructure.

**Why:** If attribution came from input, a confused agent could mark its own lines as human-added. The tool call itself is the only signal of agent authorship.

## 6. Checkout boundary: no tool reaches the order endpoint

**Call:** `POST /api/orders/confirm` exists and is called exclusively from the cart drawer's "Place order" button (a React `onClick` handler). Nothing in `src/lib/mcp-tools.ts` references it — not in tool names, descriptions, or execute bodies (the descriptions *say* checkout is unavailable, which is the demo's thesis, not a leak).

**Honest scope note:** this is a demo, not a security boundary — there is no auth, and the endpoint is reachable by anyone with the URL. The guarantee the demo makes is about the **tool surface**: an agent restricted to Fieldward's tools has no path to checkout. `scripts/verify-mcp.ts` asserts no checkout/order/payment/buy tool exists, by name.

## 7. WebMCP registration details

Raw API only (`document.modelContext.registerTool`), per the spec. Decisions within it:

- **Registration site:** a top-level client component (`McpProvider`) mounted in the root layout, so tools live as long as the document.
- **Graceful degradation:** if `document.modelContext` is missing, the shop works fully for humans; a status note in the header says tools aren't registered. No errors thrown.
- **Late-attaching contexts:** some runtimes (e.g. injected clients) expose `modelContext` after load, so the provider retries every 2 s for ~30 s instead of giving up on first paint. External harnesses can also dispatch a `fieldward:mcp-ready` event after installing a mock context.
- **Unregistration:** no bulk unregister exists in the API, so each of the 8 tools is unregistered by name in the effect cleanup. `unregisterTool` is optional in the type: some early builds ship `registerTool` without it — if absent, skip quietly rather than crash a cleanup function.

## 8. Cart sync: 2-second polling + event-driven nudge (no websockets)

**Situation:** Agent tool calls happen in the same page, but the spec asked the cart to stay live without ruling transport in or out.

**Call:** The cart store polls `GET /api/cart` every 2 s, and the tools dispatch a `fieldward:cart-changed` window event so the UI refreshes instantly when an agent tool mutates the cart (the poll remains as the safety net for out-of-band changes).

**Why not websockets/SSE:** one page, one server, a demo audience watching seconds-not-milliseconds of lag — polling keeps the code honest and small.

## 9. Money: cents in the database, dollars in the tool interface

**Call:** Prices are integer cents everywhere in the API and DB (as specced). The `filter_products` tool accepts `minPrice`/`maxPrice` in **dollars** and converts — because an agent says "under $250", not "under 25000". The tool description states this explicitly so agents don't guess.

## 10. Tailwind v4 gotcha: font tokens must be `@theme inline`

**Situation:** Headings silently rendered in the system sans stack even though `font-serif` classes were applied and Fraunces was loading.

**Cause:** `next/font` declares `--font-fraunces` / `--font-inter` on `<body>`, but a plain `@theme` block emits `--font-serif` on `:root`. CSS custom properties resolve their `var()` references at declaration time, so on `:root` (where the font variables don't exist) the whole `--font-serif` value became guaranteed-invalid — and every `.font-serif` / `.font-sans` utility fell back to the preflight default.

**Call:** Font tokens live in an `@theme inline` block, which bakes `var(--font-fraunces), …` directly into each utility class where it resolves per-element against the body-level variables. (Colors stay in the plain `@theme` block; they reference nothing runtime-defined.) This is also why the shadcn variable mapping uses `@theme inline`.

## 11. Product images: verified Unsplash CDN links via `next/image`

**Call:** Direct `images.unsplash.com` URLs (param-styled: `q=80&w=1200&auto=format&fit=crop`), rendered through `next/image` with the host whitelisted in `next.config.ts` (`images.remotePatterns`). Every URL was checked live before shipping (see `scripts/check-final-images.mjs`), and photo subjects were validated against official Unsplash dataset descriptions so a "backpack" row shows a backpack. Next's image optimizer handles responsive sizing and caching; on Vercel that comes for free.

**Related deploy note:** `next.config.ts` also lists `db/fieldward.db` in `outputFileTracingIncludes` so a stock `vercel deploy` works with zero manual config — the SQLite file rides along inside the serverless function. Writes there are ephemeral (fine for a demo; the cart resets on cold starts). The production path is the Postgres adapter swap described in entry 1.

## 12. Design system decisions

- **Palette:** warm paper `#f5f1e8`, charcoal ink, rust `#b4552b` as the single accent, moss as the quiet secondary. No indigo/blue anywhere (explicitly avoided — default-template smell).
- **Type:** Fraunces (serif, optical-size axis) for headings, Inter for body/UI — the "gear shop, not SaaS" pairing from the spec.
- **Icons:** lucide-react only, functional (cart, bot, check, alert). No emoji as UI icons.
- **Layout:** category rails + tag chips + a featured-size product grid with varied card rhythm; sticky product details on the PDP; cart as a right-side drawer. No centered hero + 3-feature-card grid.
- **Radius:** small (6 px base) — rounded-2xl-everywhere reads as a component library demo, not a shop.
- Tokens live once in the `@theme` block of `globals.css`, mirrored in `src/lib/theme.ts` for TS consumers. No one-off hex values in components.

## 13. Copy voice

Fieldward speaks like a small shop that actually uses its gear ("Broken in on the first day, not the fiftieth"). The hero count of "items on the floor" is computed from stock, so it stays true (27 of 28 — one item is deliberately out of stock to exercise that UI state). No "Welcome to Fieldward — your one-stop shop for all your outdoor adventure needs!"

## 14. What was deliberately NOT built

Per spec: no auth, no admin panel, no real payments, no in-page chatbot (the agent talks through its own client, not through the shop), no order history UI. Orders are rows with status `confirmed`. Keeping this surface small is what makes the demo legible.

---

## 15. Why the collaboration features exist (round 2)

The original build answered "can a human and an agent share one cart?" The second pass targets two WebMCP Challenge judging criteria directly:

- **Quality of the human-agent experience** — the agent stops being a silent function call. It leaves first-person reasoning on every line it adds (entry 16), proposes trip-context changes the human can see and undo (17), and can observe what the human has been doing (18). Information now flows both directions.
- **Originality** — the gear-gap check (19) reframes the app around *collaborative refinement toward a goal* ("your cart doesn't cover a winter trip yet") instead of "another shopping-agent demo." The trust boundary from the original spec is preserved: every new tool is read-only or additive; nothing new can clear a cart or place an order.

## 16. Agent notes on cart lines

**Call:** `CartItem.note` (nullable, ≤ 280 chars) set through an optional `note` input on `add_to_cart` and `update_cart_quantity`; rendered under the attribution caption as italic Fraunces with a thin moss left rule — the agent's "voice" inside the shop's editorial design, explicitly not chat-bubble styling.

**Judgment calls:** A provided note *replaces* the line's old note; omitting it keeps what was there (so a quantity bump doesn't erase the original reasoning). Notes render on any line that has one — if the agent explains a quantity change on a human-added line, that reasoning is worth showing regardless of who added the item. The note is attribution-adjacent but distinct: the caption says *who*, the note says *why*.

## 17. Trip context: propose = write immediately, undo via one-level snapshot

**Call:** `propose_context_update` writes right away with `updatedBy: "agent"` — no two-phase accept. The API snapshots the pre-agent values (`revertAvailable` + `revertTripDescription`/`revertBudget`) and the shop shows a Keep / Revert notice; a human write clears the snapshot; `POST /api/context/resolve` (added beyond the spec's two routes because the revert affordance needs a backend) performs keep or revert.

**Why not a pending-proposal queue:** an agent proposal that does nothing until accepted makes a *worse* demo — the human has to babysit every suggestion, and the agent can't ground its own searches in its proposal. Immediate write + visible one-level undo matches how good editors work: the change lands, the diff is on screen, revert is one click. Repeated agent writes keep the OLDEST snapshot (the human's last state), so revert always goes back to the human's words, not the agent's intermediate chatter. A human saving an entirely empty context deletes it (there's nothing to share); an agent writing an empty context is upserted normally so the revert path survives.

**Units:** the API stores cents (like every other money field); the tool speaks dollars (like `filter_products`) and uses `budget: 0` as the documented "clear the budget" sentinel — LLMs handle an explicit zero better than JSON null.

## 18. Activity log: one table, two readers, one writer per side

**Call:** `ActivityEvent { sessionId, actor, action, detail, createdAt }` indexed on `(sessionId, createdAt)`. Every successful agent tool call writes an event (`tool:<name>`), as does every human action worth knowing: product views (`view_product`, logged **quietly** — never toasted), cart add/update/remove, order placement, and trip-context edits/resolutions (also quiet — the editor is its own feedback). The toast strip now *reads the same table* (2s poll with an `after` cursor, first load marks-without-toasting) plus the instant window event for actions happening on the page; both paths dedupe by row id. Error toasts remain bus-only — they're UI feedback about a failed request, not shop history.

**Judgment calls:** failures are not logged (the log records what happened, not what didn't); `get_activity_log` exposes `limit`/`sinceMinutes` and returns events newest-first with machine-y `action` plus human-readable `detail`, so an agent can both pattern-match and quote. No pruning — demo sessions produce dozens of rows, not thousands; noted rather than engineered away.

## 19. Gear-gap check: a checklist, not a recommendation engine

**Call:** a static, hand-rolled map in `src/lib/gear-gaps.ts` of five trip archetypes (winter backpacking, wet-weather, backpacking, day hike, camping) → the categories/tags such a trip usually wants, keyword-matched against `ShoppingContext.tripDescription`. `check_gear_gaps` (and the cart drawer's "Still missing" panel — same pure function) reports which requirements have no matching cart line. Requirements were written against the seeded catalog's real tags so every gap is fillable by something on the floor (e.g. Shelter has no `waterproof` tag, so the wet-weather archetype asks for "a tarp or tent" instead).

**Judgment calls:** ties in keyword matching go to the earlier archetype, with winter listed first so "winter backpacking" reads as winter. The tool is analysis-only — it never adds to the cart — keeping it on the "agent proposes, human acts" side of the trust boundary. The UI panel hides entirely when there's no trip, no match, or nothing missing; when it shows, it's one small line, never a call to action.

## 20. Dev-server Prisma staleness: self-healing client cache

**Situation:** after `prisma migrate dev` + `prisma generate`, the running dev server kept serving the OLD client — `src/lib/db.ts` cached the `PrismaClient` instance on `globalThis`, so schema changes were invisible until a manual restart.

**Call:** the cache now also stores the identity of the generated `PrismaClient` constructor that built the instance, and reuses the cached client only when the constructor matches. Regenerating the client changes the constructor's identity, so the stale instance is discarded automatically. (Also noted: in Prisma 7 with this config, `migrate dev` did NOT regenerate the client — `prisma generate` must be run explicitly after schema changes.)

---

## 21. The pivot: storefront → shared planning board (round 3)

**Situation:** Round 1+2 produced a polished cart-and-checkout demo — structurally identical to several reference examples the challenge sponsors had already published (fictional marketplace, coffee store, open-source storefront). Against the "Creativity & Ambition" judging criterion, polish on a familiar shape reads as ordinary.

**Call:** Change the interaction shape, keep the problem and the philosophy. Fieldward is now a live, shared **spatial planning board** for one trip: gear items, route/day blocks, and budget as movable objects. The human drags by hand; the agent places, arranges, annotates, and checks readiness through WebMCP tools — visibly, in real time, on the same board. No cart, no checkout: the end state is a locked plan with an exportable packing list and itinerary. The trust-boundary philosophy carries over exactly — agents get everything reversible, the human keeps the one irreversible action ("Lock this plan" replaces "Place order").

**Migrated vs rebuilt:** the gear library's *data* migrated (rename + availability rework — entry 22), as did the activity log, the design system, the session/polling architecture, and the MCP registration lifecycle. The commerce flows (cart drawer, storefront grid, checkout, Order model, 8 of 12 tools) were deleted, not adapted — renaming a cart "board" would have left commerce semantics everywhere the judges look. Copy was swept with a grep for cart/checkout/order/buy/shop; the only survivors are historical (old migration SQL, these log entries).

## 22. Data model calls: availability flavor text, one BoardItem table, budget as a derived roll-up

- **`Product.stock` → `GearItem.availability` (flavor text).** A warehouse count is commerce semantics; a planning tool cares whether you can *get the thing before the trip*. Values like "Low stock — 3 pairs left" and "Waitlist until March" keep the seeded scarcity signal (an agent can say "the Granite Peak boots are nearly gone — plan the alternative") without pretending there's inventory to decrement.
- **One `BoardItem` table for gear cards AND day blocks** (`itemType: "gear" | "day"`). Both get identical drag/poll/note plumbing, one REST surface, one export path; separate tables would duplicate all of it. Day blocks carry `label`/`text` instead of `gearItemId`.
- **Budget is NOT a board row.** TripBrief owns the budget (one source of truth); the board renders a derived roll-up ("$1,503 of $2,000 planned") in the rail. A stored "budget block" would be a third copy of the same number waiting to desync.
- **`Order` was dropped outright**, replaced by `TripBrief.lockedAt` — there is no payment or order semantics to preserve, so nothing was renamed into a misleading afterlife.

The migration is deliberately destructive (drops the four commerce tables) — the database is a demo artifact with an idempotent seed, and a "careful" column-mapping migration would have preserved nothing worth keeping.

## 23. Day blocks are human-authored; the agent arranges around them

**Call:** `POST /api/board/place` rejects `itemType: "day"` with `addedBy: "agent"` (403). The agent can move and remove day blocks — just not author them.

**Why:** the demo is sharper when the trust boundary is visible *inside* the tool surface, not only around its edge. The human structures the trip ("Day 1 — Trailhead to Cairn Lake"); the agent fills it in and groups gear under the right days with `move_board_item`. Both parties see the same refusal: a judge who asks the agent to "add a summit day" gets an honest "day blocks are yours" instead of a silently different result from the UI path.

## 24. Brief proposals are now truly pending — this supersedes entry 17

**Call:** `propose_trip_brief_update` stores a suggestion (`TripBrief.proposalJson`) and changes **nothing** until the human clicks Accept or Dismiss in the brief panel.

**Why the reversal:** in the store, the context was one input among many and write-then-revert kept the demo flowing (entry 17's argument). In the pivot, the brief is the framing document for the entire board — the readiness check reads it, searches ground in it, the budget line hangs off it. Letting the agent silently rewrite the human's framing would undermine the co-editing story the pivot exists to tell. The accept/dismiss UI is explicit enough that babysitting cost is low (one banner, two buttons), and `get_trip_brief` returns the agent's own pending proposal so it can phrase suggestions correctly ("if you accept…"). `updatedBy` on the brief is now only ever "human" — the agent never writes the live fields, period.

## 25. `place_on_board` without coordinates: the server does layout math

**Call:** x/y are optional on placement (tool and REST). Omitted, the server scans a 1440×960 working region left-to-right, top-to-bottom for the first slot that doesn't collide with an existing card (`nextOpenPosition` in `src/lib/board-geometry.ts`); supplied coordinates are clamped to the 2400×1600 board. The human gets the same default via the tray's + button and the gear page's "Place on the board".

**Why:** agents should think about the trip, not pixel coordinates — and a tool that demands layout math invites off-board garbage. The scan is deterministic, so repeated placements cascade down the board instead of stacking, and the returned item includes the chosen coordinates so the agent can build on them (e.g. place at x+240 to sit beside a day block).

## 26. The Declarative WebMCP API: considered, deliberately skipped

**Call:** The trip brief is implemented on the imperative API only. It IS a real semantic `<form>` (labelled inputs, name attributes, submit handler) so a declarative layer could annotate it without JS changes — but no declarative annotations ship.

**Why:** the challenge's measurable surface is the imperative `registerTool` API, which the test browsers verifiably support; the declarative form annotation surface was still moving at build time, and shipping guessed attribute names in a judged submission is worse than not shipping them. Documenting the trade-off (here, and in the form's structure) demonstrates the knowledge the criterion rewards without betting the demo on unstable syntax.

## 27. Lock semantics: server-enforced 409, one-way within a plan, human-only reset

**Call:** Locking sets `TripBrief.lockedAt` from the human-only `POST /api/brief/lock` (no tool exists; verify-mcp asserts none ever does). While locked, every board and brief mutation route returns 409 — the tools surface it as a clean error ("This plan is locked…"), so even a rogue tool can only read. The export view (packing list + itinerary in board order + budget roll-up, printable) is fully derived from the frozen board. "Start a new plan" wipes the session's board/brief/log and is human-only too — an agent must never be able to erase the human's work.

**Why not unlock:** reversibility would make locking a toggle, not a decision; the trust-boundary beat is stronger as a one-way door. Replayability (a judge wanting to try again) is handled by the reset path instead. The export sorts day blocks top-to-bottom then left-to-right, so the spatial arrangement the pair settled on literally becomes the itinerary order.

## 28. Agent actions must animate exactly like human drags

**Requirement:** the pivot's single most important visual proof is that the agent is a real co-editor, not a hidden backend process.

**Call:** one board store, one source of truth. Human drags go through dnd-kit (PointerSensor + DragOverlay) and persist on drop; agent placements/moves hit the same REST routes, and the store's 1.5s poll — nudged instantly by a `fieldward:board-changed` event from the tool layer — reconciles into the same React state. Cards always carry `transition: transform 500ms` (except mid-drag), so a poll-detected position change glides exactly like a settled human drag; new cards mount with a card-enter keyframe so an agent placement reads as a live event, not a re-render.

## 29. Two real bugs the verification harness caught (and why that justifies it)

- **The brief lock-check bug:** `existing?.lockedAt !== null && existing !== undefined` — true when no brief exists (`undefined !== null`), so fresh sessions were treated as locked and every proposal failed. Found by verify-loop's step 2; the unit-ish verify-mcp passed because it crashed before reaching the brief section. Fixed to `existing !== null && existing.lockedAt !== null`.
- **The DndContext scoping bug:** the gear tray rendered outside the `DndContext` (which lived inside the board canvas component), so `useDraggable` on tray rows received an empty internal context and attached no listeners — human tray drags were silently, completely dead. The UI looked fine; only a browser test dragging like a human found it. Fix: hoist DndContext to the workspace so tray and board share one drag operation (which a tray→board drag requires anyway).

**Lesson logged:** type checks and tool-path tests can't see either class of failure. The browser E2E drives the REAL native `document.modelContext` (getTools() + executeTool() — the same path a host agent takes), and now runs the whole collaboration loop end-to-end.

## 30. Round-3 verification surface

`verify-mcp.ts` (74 assertions): every tool happy+error path; hardcoded attribution; note persistence; pending-proposal semantics (live brief untouched until accept; dismiss leaves values); server default placement; coordinate clamping; agent-blocked day-block creation and direct brief edits (403); locked-plan refusals on every mutating tool; register/unregister contract; explicit no-lock/export/reset/checkout-tool check. `verify-loop.ts` (30 assertions): the full conversation as one chain, including the budget-overrun proposal beat and export data integrity. `browser-e2e.sh` (24 checks): brief UI round-trip, live agent placement + note rendering, live move transform, human tray drag, day blocks, proposal banner + accept, lock → export view, locked refusals, mobile overflow. All green at commit time.

## 31. The pending-proposal mechanism generalized into its own table

**Call:** day-order suggestions reuse the brief-proposal mechanism by *generalizing* it, not by cloning it: `TripBrief.proposalJson` became a `Proposal` table keyed `(sessionId, kind)` — one pending suggestion per session per domain ("brief" | "day-order"), payload JSON parsed per kind in `src/lib/proposals.ts`, resolved rows deleted (the activity log is the durable record of verdicts). The migration carries any pending brief proposals across and drops the old column; `POST /api/brief/reset` now wipes proposals too. The UI half generalized the same way: the accept/dismiss banner was extracted into one `ProposalBanner` component both domains render.

**Why:** the second proposal domain was the point. A bespoke `dayOrderJson` column (or a second ad-hoc flow) would have made the accept/dismiss pattern look like a one-off that happened twice; a shared table, shared lib, and shared banner make it a *design language* for how the agent influences consequential things. The behavioral invariants are identical in both domains: propose replaces the pending suggestion of its kind, applies nothing, and the matching `/resolve` route is the only applier.

## 32. Day order IS spatial order — applying a proposal reassigns slots, not a sequence field

**Call:** the audit found day blocks have no order field; their sequence is *derived* — top-to-bottom, then left-to-right (the export itinerary reads them that way). `suggest_day_order` + accept therefore work through positions: the existing day-block positions, sorted into reading order, become slots, and the proposed sequence decides which block occupies which slot (`planDayOrderReassignment` in `src/lib/day-order.ts`). No new column, and the accepted order is what every consumer already reads.

**Why:** adding a `dayOrder` int would have created a *second* source of truth for sequence — one that the human's drags (which change y) wouldn't maintain, silently desyncing board order from itinerary order. Slot reassignment keeps one truth: after accept, the board's layout shape is exactly the human's, only the reading order changed — and the blocks visibly glide to their new slots with the same transform transitions as any other move, which is the demo's whole "co-editor" beat. Validation is strict at both propose and resolve time: the array must be a *complete* ordering of the session's day blocks (all ids known, no duplicates, nothing missing); if the human edits their day blocks between proposal and accept, the stale suggestion is discarded with a 409 and the agent is told to suggest again. The 403 on agent-authored day blocks is untouched — this tool reorders blocks the human already created, nothing more.

## 33. Weather grounding: three honest states, one server route, TTL-cached upstream

**Call:** `get_weather_outlook` reads the trip's place and dates off the brief and returns exactly one of: `dataSource: "forecast"` (real Open-Meteo daily forecast — the trip ends within ~16 days, start clamped to today if underway), `"historical-average"` (the same calendar window averaged over the last four complete years from Open-Meteo's ERA5 archive), or `"unavailable"` (with a reason: place/dates unset, unfindable place, past dates, or upstream unreachable). The state is never blurred — the tool output, the chip label ("Real forecast" / "Seasonal average" / "Not available"), the readiness fold, and the activity-log copy all name which state they're quoting. All upstream calls happen in one server module (`weather-open-meteo.ts`) behind `GET /api/weather` with TTL caches (geocode 24h, forecast 30min, historical 6h, failures 60s), so the chip, the tool, and the readiness fold share one round trip per window.

**Why:** the readiness check only matched static tags against static archetypes — internally consistent, grounded in nothing. Real forecasts make the check answer a real question ("rain likely on day 2"). But Open-Meteo's forecast is only reliable ~16 days out, and trips get planned months ahead — pretending certainty there would be worse than the old static check. Hence the three-state contract: within the horizon, real data; beyond it, an *averaged seasonal estimate from real historical data*, labeled as such; and when the inputs or the service can't support either, a clear reason instead of an error. The boundary rule is deliberately whole-window (forecast only if the *end* date is within the horizon; otherwise the whole window gets the average) so a single outlook never mixes two data sources mid-trip.

## 34. The seasonal average is computed, not fetched: same calendar window, four past years

**Call:** "historical average" = the trip's own calendar window (same month/day range) pulled from Open-Meteo's archive API for each of the last four complete years, averaged per trip-day. Feb 29 in a non-leap historical year clamps to Feb 28 (windows that come back shorter are capped to the shortest — trip day i is averaged at index i); year-boundary trips (Dec 28 → Jan 2) keep their window contiguous into year+1; a year with any data hole is skipped entirely rather than averaged around, and `sampledYears` in the output says how many years actually made it. Both the number of years and the cap rule are pinned by fixtures in `scripts/verify-mcp.ts`.

**Why:** averaging the trip's own window is what "what is late November usually like there" actually means — a climate normals service would answer a slightly different question, and picking a forecast-shaped endpoint would have re-introduced the honesty problem one layer down. Four years is enough to smooth one odd year without dragging in a different climate decade. Skipping holey years costs a sample but keeps every published average computed from complete windows.

## 35. Weather gaps are grounded in the real catalog, and overlap with archetype gaps is not deduplicated

**Call:** weather contributes exactly two gear-gap signals, each mapped to tags the seeded library actually carries: rain (forecast: any day ≥1 mm or ≥50% chance; historical: any averaged day ≥2.5 mm) → something tagged `waterproof`; a freezing night (lows ≤ 0°C) → something tagged `winter-rated`. `check_trip_readiness` folds them into its existing gaps array (`mergeReadinessWithWeather`), appends the weather grounding to the result, and the rail's readiness panel runs the *same* pure fold — one coherent result, not a weather panel next to a trip-type panel. Deliberately *no* deduplication against archetype gap lines: "no waterproof footwear" (a category test) and "rain likely on day 2 — no board item tagged waterproof yet" (any-gear test) answer different questions, and each line is independently true and fillable from the tray.

**Why:** the existing readiness check earned trust by never reporting a gap the library can't fill — wind and heat have no grounded gear answer here, so they produce no gap lines despite being easy to detect. Two signals that map to real picks beat four that map to nothing. The dedupe idea (skip the weather-rain gap when the archetype already says "waterproof footwear") was considered and rejected: substring overlap is not semantic duplication, and hiding the weather line would make the fold look like it didn't happen.

## 36. Rate-limit reality: the contract is tested deterministically; live data whenever upstream allows

**Call:** Open-Meteo's anonymous tier is IP-rate-limited, and the IP this project was built behind sat on an exhausted quota during development and testing (forecast/archive answer 429; geocoding drops connections from Node outright while curl sails through — an egress quirk, not an upstream outage). The code stays simple and honest — single attempt, 8s timeout, failures become clean `unavailable` outlooks with reasons, cached 60s. The harnesses verify the three-state *contract* deterministically: the unavailable paths (unset, unfindable place, past dates) are asserted outright; the forecast and seasonal-average paths accept either the live result or the honest service-unavailable fallback, logging which occurred; and the parsing, averaging, summary, and gap logic is pinned by Open-Meteo-shaped fixture tests into the pure functions, so the data paths are fully covered regardless of upstream mood. No retry loops, no test-only branches in production code — a rate-limited chip that says "try again in a moment" is the correct product behavior, not a bug to engineer around.

## 37. Place and dates are human-only inputs; resolve routes stay human-UI paths

**Call:** the trip's place and dates are set only by the human through the brief panel (and `POST /api/brief/update`, which still 403s `updatedBy: "agent"`). `propose_trip_brief_update` was *not* extended to propose location/dates. The day-order resolve route follows the existing trust model: like `/api/brief/resolve`, it is the human UI's path (the banner's Accept/Dismiss buttons), carries no actor field, and is never referenced by any tool — the agent's surface only creates proposals. Also fixed while in there: `/api/brief/update` claimed "empty string clears it" for the description but `optionalString` mapped `""` to absent and the route 400'd — clear-semantics now come from a `sentString` helper, and dates are stored as noon-UTC DateTimes so timezone math can never flip the calendar day.

**Why:** the agent can reason about *anything*, but it cannot know where the human is actually going or when they're actually free — those are facts about the human's life, and letting an agent propose (let alone write) them would be the one place the proposal pattern makes the demo *dumber*, not more agentic. Weather quality depends on these fields being right, which is exactly why they stay human-entered: garbage dates in, honestly-unavailable weather out. And the resolve routes' trust model matches the rest of the app: the sessionId-scoped HTTP surface is shared plumbing, the *tool surface* is the agent's boundary, and the consequential verbs (lock, reset, resolve, author days) live on the human side of that line.

## 38. Stable DndContext id — the hydration mismatch that only appears on a warm server

**Call:** the board's single `DndContext` passes an explicit `id="fieldward-board"`. dnd-kit derives every draggable's `aria-describedby` (and the hidden screen-reader instruction element it points at) from `DndContext`'s `id` — and without an explicit value it falls back to a module-level counter ("DndDescribedBy-0", "-1", …). That counter increments on *every SSR render the server process has ever done*, while each fresh browser load restarts at 0 — so any page served after the first handful of requests hydrates with a mismatched `aria-describedby` and React 19 surfaces a hydration error. A constant id keeps server and client in permanent agreement; it stays unique because the page has exactly one DndContext (a deliberate earlier call — tray and board must share one drag scope).

**Why:** the error is invisible in a fresh dev session (counters coincide at 0) and shows up precisely on a long-lived server — i.e. in every deployed or demoed instance, the worst possible presentation for a "verified" app. The explicit-id escape hatch is dnd-kit's own designed answer (the prop exists for exactly this), costs nothing, and keeps the accessibility wiring intact: the `aria-describedby` still resolves to the real instruction text, verified in the browser E2E.

## 39. A changed weather window clears the chip, not just reloads it

**Call:** `useWeatherStore.refresh()` now drops the previous outlook the moment the brief's place/dates *identity* changes, so the chip flips to its honest "Checking the outlook for those dates…" state while the new window loads (and an in-flight guard stops refreshes for the same window from stacking). Same-window refreshes still keep the old outlook up — only a *changed* window clears it.

**Why:** the previous behavior kept rendering the OLD window's outlook during the re-fetch: fix an unfindable place and the chip still said "I couldn't find '<old place>'" for several seconds with no sign of re-checking — and worse, the readiness panel kept folding *the wrong window's* rain/freezing gaps into its output. Honesty is the stated design constraint of the weather feature (DECISIONS 33): showing another window's data with no label breaks it more quietly than the three states ever did. The regression was caught by the browser E2E's chip-vs-API consistency check, which polls the chip's `data-weather-state` while the direct API call lands after the fetch — stale `unavailable` on the chip vs. `historical-average` from the API was the tell.

## 40. "Already own it" marking: personal inventory without fake commerce or budget distortion

**Call:** `mark_item_owned` tool fuzzy-matches catalog items or creates a new `GearItem` (`source: "owned"`, price: 0). `BoardItem` carries `ownership: "owned" | "needed"` (default `"needed"`). Items placed via `mark_item_owned` are positioned in the top "Already Have (Owned)" zone (`y: 0–380`). Dragging cards across the `OWNED_ZONE_BOUNDARY_Y = 380` divider automatically syncs ownership between `"owned"` and `"needed"`. `gearTotalCents` sums strictly `"needed"` items (so owned gear has $0 budget impact), while `computeTripReadiness` inspects all board gear lines regardless of ownership to satisfy checklist requirements.

**Why:** Real trip planning always begins with the gear in your closet. Without owned-item marking, users either had to leave essential gear off the board (breaking the readiness checklist) or place catalog cards that consumed their acquisition budget. Treating owned items as first-class board objects with $0 budget impact and full readiness satisfaction solves both without introducing fake commerce mechanics.

## 41. Multi-date comparison: concurrent hypothetical previews with single parameterized weather core

**Call:** `compare_trip_dates` accepts 2–3 candidate date ranges and returns independent weather outlooks and readiness gap analyses for each. The weather engine (`src/lib/weather-open-meteo.ts`) was refactored into a single parameterized core (`getWeatherOutlookForParams`), shared by `get_weather_outlook`, `check_trip_readiness`, and `compare_trip_dates`. Multi-date lookups run concurrently via `Promise.allSettled` with graceful partial failure handling (e.g. one valid forecast and one past date range return independent `dataSource` tags without failing the request). The UI presents a side-by-side comparison panel above the board canvas with a single-click "Use these dates" action that applies the chosen candidate range directly to the trip brief.

**Why:** Date selection is the central decision in trip planning: a trip in early September requires ultralight rain shells, while the same route in late November requires expedition insulation and 4-season shelter. Letting the agent compare candidate windows side-by-side in real time — with live forecast vs historical average labels — gives human and agent a shared basis to choose the safest window before kit assembly begins.
