/**
 * The full human+agent collaboration loop, executed as one script.
 *
 * Not isolated tool tests (see verify-mcp.ts for those) — this simulates the
 * order a real agent conversation would chain, with the human acting in
 * between, and asserts the pieces actually build on each other:
 *
 *   agent reads the (empty) brief → proposes the trip → human accepts and
 *   sketches day blocks → agent grounds searches in the trip → human sets
 *   the trip's place and dates → agent pulls the weather outlook and
 *   re-checks readiness with weather-driven gaps → agent suggests a day
 *   order → human accepts it (the board reorders) → agent suggests again →
 *   human dismisses (nothing moves) → agent filters under the budget →
 *   compares → places picks WITH notes → moves one to group it under a day
 *   block → checks readiness → fills the gap it found → catches up on the
 *   activity log (seeing BOTH sides) → notices the budget overrun and
 *   proposes a fix → human declines → human locks the plan → every agent
 *   mutation is refused.
 *
 * Usage:
 *   bun run dev            # in another terminal (server must be up)
 *   bun run scripts/verify-loop.ts
 */
import { buildToolDefinitions, type WebMCToolDefinition } from "../src/lib/mcp-tools";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_ID = `loop-${Date.now()}`;

(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => (key === "fieldward:session" ? SESSION_ID : null),
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as Record<string, unknown>).dispatchEvent = () => true;

const originalFetch = globalThis.fetch.bind(globalThis);
(globalThis as Record<string, unknown>).fetch = (input: unknown, init?: RequestInit) =>
  originalFetch(new URL(String(input), BASE).href, init);

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await originalFetch(`${BASE}${path}`, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

const json = (payload: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

/**
 * In the real app, HUMAN actions are logged by the client stores (the
 * browser side knows who's acting); the script simulates the human via raw
 * API calls, so it writes the same activity rows the browser would.
 */
async function humanAction(action: string, detail: string): Promise<void> {
  await api("/api/activity/log", json({ sessionId: SESSION_ID, actor: "human", action, detail }));
}

async function main() {
  console.log(`Running the Fieldward collaboration loop against ${BASE}\n`);
  const tools = new Map<string, WebMCToolDefinition>(buildToolDefinitions().map((t) => [t.name, t]));
  const exec = async (name: string, input: Record<string, unknown>) =>
    (await tools.get(name)!.execute(input)) as Record<string, unknown>;

  // ── 1. Agent grounds itself: read the trip brief ─────────────────────────
  console.log("── Agent: get_trip_brief (nothing set yet)");
  const briefFirst = await exec("get_trip_brief", {});
  check("1. agent reads the brief — none set, gets a hint instead", briefFirst.success === true && briefFirst.brief === null);

  // ── 2. Agent proposes the trip it just learned about ─────────────────────
  console.log("── Agent: propose_trip_brief_update (winter trip, $500)");
  const propose = await exec("propose_trip_brief_update", {
    tripDescription: "3-day winter backpacking trip in the Cascades",
    budget: 500,
  });
  const proposed = propose.brief as Record<string, unknown> | null;
  check("2. proposal lands as PENDING", propose.success === true && proposed?.pendingProposal !== null);
  check("2b. live brief untouched until the human decides", proposed?.tripDescription === "");

  // ── 3. Human accepts, sketches the days, places a first card ─────────────
  console.log("── Human: accepts, adds Day 1 + Day 2, places a tent");
  const accept = await api("/api/brief/resolve", json({ sessionId: SESSION_ID, decision: "accept" }));
  check("3. human accepts the proposal", accept.ok && (accept.body.brief as Record<string, unknown>)?.tripDescription?.includes("winter"));

  const day1 = await api("/api/board/place", json({
    sessionId: SESSION_ID, itemType: "day", label: "Day 1 — Trailhead to Cairn Lake", text: "6 mi · 1,900 ft gain", addedBy: "human", x: 64, y: 64,
  }));
  const day2 = await api("/api/board/place", json({
    sessionId: SESSION_ID, itemType: "day", label: "Day 2 — Cairn Lake to The Saddle", text: "9 mi · high pass", addedBy: "human", x: 64, y: 300,
  }));
  check("3b. human authors day blocks", day1.ok && day2.ok);
  await humanAction("place_day", "You added a day block — Day 1 — Trailhead to Cairn Lake.");
  await humanAction("place_day", "You added a day block — Day 2 — Cairn Lake to The Saddle.");

  const stoveSearch = await exec("search_gear", { query: "stove" });
  const stove = ((stoveSearch.results ?? []) as Array<Record<string, unknown>>)[0];
  const humanPlace = await api("/api/board/place", json({
    sessionId: SESSION_ID, itemType: "gear", gearItemId: stove.id, addedBy: "human", x: 400, y: 320,
  }));
  check("3c. human places cook gear near Day 2", humanPlace.ok && (humanPlace.body.item as Record<string, unknown>)?.addedBy === "human");
  await humanAction("place_gear", `You placed ${stove.name} on the board.`);

  // ── 4. Agent re-grounds: brief + board + log before acting ───────────────
  console.log("── Agent: get_trip_brief + get_board_state + get_activity_log");
  const briefRead = await exec("get_trip_brief", {});
  const boardRead = await exec("get_board_state", {});
  const logRead = await exec("get_activity_log", { limit: 30 });
  check("4. agent sees the accepted trip", (briefRead.brief as Record<string, unknown>)?.tripDescription?.includes("winter"));
  check("4b. agent sees the human's 2 day blocks + 1 gear card", (boardRead.itemCount as number) === 1 && ((boardRead.items ?? []) as unknown[]).filter((i) => (i as Record<string, unknown>).itemType === "day").length === 2);
  const logEvents = (logRead.events ?? []) as Array<Record<string, unknown>>;
  check(
    "4c. activity log shows the human's day blocks to the agent",
    logEvents.some((e) => e.actor === "human" && e.action === "place_day"),
  );

  // ── 5. Human grounds the trip in a real place and dates ─────────────────
  console.log("── Human: sets place + dates in the brief; Agent: get_weather_outlook");
  const setLocation = await api("/api/brief/update", json({
    sessionId: SESSION_ID,
    tripDescription: "3-day winter backpacking trip in the Cascades",
    budget: 50000,
    location: "North Cascades",
    startDate: "2026-11-15",
    endDate: "2026-11-18",
    updatedBy: "human",
  }));
  check(
    "5. human set the trip's place and dates",
    setLocation.ok && (setLocation.body.brief as Record<string, unknown>)?.location === "North Cascades",
  );
  await humanAction("update_brief", "You set the trip's place and dates — North Cascades, Nov 15–18.");

  const outlook = await exec("get_weather_outlook", {});
  const outlookLive = outlook.dataSource === "forecast" || outlook.dataSource === "historical-average";
  check("5b. agent pulled the weather outlook", outlook.success === true && typeof outlook.dataSource === "string");
  if (outlookLive) {
    console.log(`     (live outlook: ${outlook.dataSource})`);
    check("5c. outlook covers all four trip days", Array.isArray(outlook.days) && outlook.days.length === 4);
    check(
      "5d. outlook names the place it geocoded",
      String((outlook.location as Record<string, unknown> | undefined)?.name ?? "").length > 0,
    );
    check(
      "5e. outlook summary is honest about its data source",
      outlook.dataSource === "historical-average"
        ? /seasonal average/i.test(String(outlook.summary))
        : String(outlook.summary).length > 0,
    );
  } else {
    console.log(`     (upstream unavailable right now: ${outlook.reason})`);
    check("5c. unavailable outlook carries a reason", typeof outlook.reason === "string" && outlook.reason.length > 0);
  }

  // ── 6. Readiness, now grounded in the real outlook ──────────────────────
  console.log("── Agent: check_trip_readiness (weather-folded)");
  const readinessW = await exec("check_trip_readiness", {});
  const gapsW = (readinessW.gaps ?? []) as string[];
  check("6. readiness still matches the winter trip", readinessW.matched === true);
  check(
    "6b. readiness carries the same weather grounding as the outlook",
    (readinessW.weather as Record<string, unknown>)?.dataSource === outlook.dataSource,
  );
  if (outlookLive) {
    // Only the human's stove is on the board so far: nothing waterproof,
    // nothing winter-rated — a live rain/cold signal MUST show up as a gap.
    check(
      "6c. weather-driven gap folded into the readiness result",
      gapsW.some((gap) => gap.includes("no board item tagged")),
      JSON.stringify(gapsW),
    );
  } else {
    check(
      "6c. no weather gaps invented while the outlook is unavailable",
      gapsW.every((gap) => !gap.includes("no board item tagged")),
      JSON.stringify(gapsW),
    );
  }

  // ── 6d. Human mentions gear they already own → Agent marks it owned ─────
  console.log("── Agent: mark_item_owned (Nightfall 20° Sleeping Bag) + check_trip_readiness");
  const budgetBeforeOwned = ((await exec("get_board_state", {})).gearTotalCents as number);
  const markOwned = await exec("mark_item_owned", {
    name: "Nightfall 20° Sleeping Bag",
    note: "Human already owns this sleeping bag in their closet.",
  });
  check("6d. agent marks the sleeping bag as already owned", markOwned.success === true && markOwned.matchedExisting === true);
  const boardAfterOwned = await exec("get_board_state", {});
  check("6e. owned item did not increase acquisition budget spend", boardAfterOwned.gearTotalCents === budgetBeforeOwned);

  const readinessAfterOwned = await exec("check_trip_readiness", {});
  check(
    "6f. readiness reflects owned item satisfying the winter shelter requirement",
    ((readinessAfterOwned.covered as string[]) ?? []).some((c) => c.includes("sleep system") || c.includes("shelter")),
    JSON.stringify(readinessAfterOwned.covered),
  );

  // ── 6g. Agent compares two candidate date windows side-by-side ───────────
  console.log("── Agent: compare_trip_dates (Sept vs Nov candidate windows)");
  const compareDates = await exec("compare_trip_dates", {
    dateRanges: [
      { startDate: "2026-09-05", endDate: "2026-09-08", label: "Option A: Late Summer" },
      { startDate: "2026-11-15", endDate: "2026-11-18", label: "Option B: Early Winter" },
    ],
  });
  check("6g. agent compares candidate date ranges side-by-side", compareDates.success === true && compareDates.comparisonCount === 2);
  const compList = (compareDates.comparisons as Array<{ weather: { dataSource: string }; readiness: { matched: boolean } }>);
  check(
    "6h. candidate date ranges carry independent weather and readiness evaluations",
    compList.length === 2 && typeof compList[0]?.weather.dataSource === "string" && typeof compList[1]?.weather.dataSource === "string",
  );

  // ── 7. Agent suggests a day order; the human decides ────────────────────
  console.log("── Agent: suggest_day_order (lake camp first) → Human: accepts");
  const boardForOrder = await exec("get_board_state", {});
  const dayBlocksNow = ((boardForOrder.items ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.itemType === "day",
  );
  const orderedByY = [...dayBlocksNow].sort(
    (a, b) => (a.y as number) - (b.y as number) || (a.x as number) - (b.x as number),
  );
  const dayIds = orderedByY.map((item) => item.id as string);
  check("7. agent reads both day blocks in board order", dayIds.length === 2);

  const suggestOrder = await exec("suggest_day_order", {
    orderedBoardItemIds: [dayIds[1], dayIds[0]],
    note: "The pass is calmer before the storm window — lake camp first.",
  });
  check(
    "7b. day-order suggestion lands as PENDING",
    suggestOrder.success === true && JSON.stringify(suggestOrder.proposal).includes(dayIds[1]),
  );
  const boardPending = ((await exec("get_board_state", {})).pendingDayOrder ?? null) as
    | Record<string, unknown>
    | null;
  check(
    "7c. the board exposes the pending day order",
    boardPending !== null && JSON.stringify(boardPending).includes(dayIds[1]),
  );

  const acceptOrder = await api("/api/board/day-order/resolve", json({ sessionId: SESSION_ID, decision: "accept" }));
  const acceptedItems = (acceptOrder.body.items ?? []) as Array<Record<string, unknown>>;
  const acceptedDays = acceptedItems
    .filter((item) => item.itemType === "day")
    .sort((a, b) => (a.y as number) - (b.y as number));
  check("7d. human accepted the day order — both blocks traded slots", acceptOrder.ok && acceptOrder.body.movedCount === 2);
  check("7e. the board now reads Day 2 first (the accepted proposal)", String(acceptedDays[0]?.label).startsWith("Day 2"));
  await humanAction("resolve_day_order_proposal", "You accepted the agent's day order.");

  // A second suggestion, dismissed: nothing moves.
  const suggestAgain = await exec("suggest_day_order", { orderedBoardItemIds: [dayIds[0], dayIds[1]] });
  check("7f. second day-order suggestion lands pending", suggestAgain.success === true);
  const dismissOrder = await api("/api/board/day-order/resolve", json({ sessionId: SESSION_ID, decision: "dismiss" }));
  const dismissedItems = (dismissOrder.body.items ?? []) as Array<Record<string, unknown>>;
  const dismissedDays = dismissedItems
    .filter((item) => item.itemType === "day")
    .sort((a, b) => (a.y as number) - (b.y as number));
  check(
    "7g. human dismissed the second suggestion — no change, proposal cleared",
    String(dismissedDays[0]?.label).startsWith("Day 2") &&
      (await exec("get_board_state", {})).pendingDayOrder === null,
  );
  await humanAction("resolve_day_order_proposal", "You dismissed the agent's second day order.");

  // ── 8. Agent searches grounded in the trip, under budget ─────────────────
  console.log("── Agent: search_gear (winter-rated) + filter_gear (under $500)");
  const winterSearch = await exec("search_gear", { query: "winter-rated", limit: 10 });
  const winterResults = (winterSearch.results ?? []) as Array<Record<string, unknown>>;
  check("8. grounded search finds winter-rated gear", winterResults.length >= 3);

  const packsFilter = await exec("filter_gear", { category: "Backpacks", maxPrice: 500 });
  const packs = (packsFilter.results ?? []) as Array<Record<string, unknown>>;
  check("8b. every pack is under the $500 budget", packs.length >= 2 && packs.every((p) => (p.price as number) <= 50000));

  // ── 9. Agent compares the two strongest pack candidates ──────────────────
  console.log("── Agent: compare_gear (two packs)");
  const compare = await exec("compare_gear", { gearItemIds: [packs[0].id, packs[1].id] });
  check("9. comparison returns both packs", compare.success === true && (compare.gear as unknown[]).length === 2);

  // ── 10. Agent places its picks WITH reasoning, grouped near the days ──────
  console.log("── Agent: place_on_board ×2 with notes");
  const cairnPack = packs.find((p) => p.name === "Cairn 65L Expedition Pack") ?? packs[0];
  const tent = winterResults.find((g) => (g.tags as string[]).includes("winter-rated") && g.category === "Shelter");
  const placePack = await exec("place_on_board", {
    gearItemId: cairnPack.id as string,
    x: 400, y: 96,
    note: "Expedition-sized for three winter days — the harness stays friendly at fifty pounds.",
  });
  const placeTent = await exec("place_on_board", {
    gearItemId: tent?.id as string,
    note: "I picked this over the lighter quilt — winter-rated is the right call for your dates.",
  });
  check("10. agent placed the pack at Day 1's side", placePack.success === true && (placePack.item as Record<string, unknown>)?.x === 400);
  check("10b. agent placed the tent with server-chosen position + note", placeTent.success === true && typeof (placeTent.item as Record<string, unknown>)?.note === "string");
  check(
    "10c. both agent cards attributed to the agent",
    (placePack.item as Record<string, unknown>)?.addedBy === "agent" && (placeTent.item as Record<string, unknown>)?.addedBy === "agent",
  );

  // ── 11. Agent arranges: moves the human's stove under Day 2 ───────────────
  console.log("── Agent: move_board_item (group cook gear under Day 2)");
  const boardNow = await exec("get_board_state", {});
  const stoveCard = ((boardNow.items ?? []) as Array<Record<string, unknown>>).find(
    (i) => i.gearItemId === stove.id,
  );
  const move = await exec("move_board_item", { boardItemId: stoveCard!.id as string, x: 660, y: 300 });
  check("11. agent moved the human's card — co-editing, not just adding", move.success === true && (move.item as Record<string, unknown>)?.x === 660);

  // ── 12. Agent checks readiness against the trip ───────────────────────────
  console.log("── Agent: check_trip_readiness");
  const readiness = await exec("check_trip_readiness", {});
  const gaps = (readiness.gaps ?? []) as string[];
  check("12. readiness matched the winter trip", readiness.matched === true);
  check("12b. footwear gap reported", gaps.includes("no waterproof or winter-rated footwear on the board"));

  // ── 13. Agent fills the gap it found, then re-checks ─────────────────────
  console.log("── Agent: places winter boots, re-checks readiness");
  const boots = winterResults.find((g) => g.category === "Footwear");
  const placeBoots = await exec("place_on_board", {
    gearItemId: boots?.id as string,
    x: 400, y: 420,
    note: "Crampon-compatible and insulated — fills the footwear gap for minus-thirty overnights.",
  });
  const readiness2 = await exec("check_trip_readiness", {});
  check("13. gap filled by the agent's placement", placeBoots.success === true && !((readiness2.gaps ?? []) as string[]).includes("no waterproof or winter-rated footwear on the board"));

  // ── 14. Agent notices the budget overrun and proposes a fix ──────────────
  console.log("── Agent: get_board_state → propose_trip_brief_update (raise budget)");
  const boardTotal = await exec("get_board_state", {});
  const briefNow = await exec("get_trip_brief", {});
  const budgetCents = (briefNow.brief as Record<string, unknown>)?.budget as number;
  const totalCents = boardTotal.gearTotalCents as number;
  check("14. board total is computed", typeof totalCents === "number" && totalCents > 0);

  if (totalCents > budgetCents) {
    console.log(`   (board $${(totalCents / 100).toFixed(0)} > budget $${(budgetCents / 100).toFixed(0)} — overrun beat plays)`);
    const raiseBudget = await exec("propose_trip_brief_update", { budget: Math.ceil(totalCents / 100) + 50 });
    check(
      "14b. agent proposes raising the budget — as a PENDING suggestion",
      raiseBudget.success === true && ((raiseBudget.brief as Record<string, unknown>)?.pendingProposal !== null),
    );
    const decline = await api("/api/brief/resolve", json({ sessionId: SESSION_ID, decision: "dismiss" }));
    const declined = (decline.body.brief as Record<string, unknown>);
    check("14c. human declines — budget unchanged, proposal cleared", declined?.budget === budgetCents && declined?.pendingProposal === null);
  } else {
    console.log("   (board under budget — proposing a LOWER cap to exercise the beat)");
    const lowerBudget = await exec("propose_trip_brief_update", { budget: 100 });
    check("14b. agent proposes a budget change — pending", lowerBudget.success === true);
    const decline = await api("/api/brief/resolve", json({ sessionId: SESSION_ID, decision: "dismiss" }));
    check("14c. human declines — budget unchanged", ((decline.body.brief as Record<string, unknown>)?.budget) === budgetCents);
  }

  // ── 15. Human locks the plan; the agent is locked out ────────────────────
  console.log("── Human: locks the plan → Agent: attempts one more move");
  const lock = await api("/api/brief/lock", json({ sessionId: SESSION_ID }));
  check("15. human locks the plan", lock.ok);
  await humanAction("lock_plan", "You locked the plan. That step stays human.");

  const lockedRead = await exec("get_board_state", {});
  check("15b. board reports locked", lockedRead.locked === true);

  const lateMove = await exec("move_board_item", { boardItemId: stoveCard!.id as string, x: 900, y: 900 });
  check("15c. agent's late move is refused", lateMove.success === false);

  const lateLog = await exec("get_activity_log", { limit: 50 });
  const lateEvents = (lateLog.events ?? []) as Array<Record<string, unknown>>;
  check(
    "15d. the whole conversation is in the log — both actors",
    lateEvents.some((e) => e.actor === "agent" && e.action === "tool:place_on_board") &&
      lateEvents.some((e) => e.actor === "human" && e.action === "place_day") &&
      lateEvents.some((e) => e.actor === "human" && e.action === "lock_plan"),
  );

  // ── 16. The export view has everything it needs ───────────────────────────
  console.log("── Export data integrity");
  const exportBoard = await api(`/api/board?sessionId=${SESSION_ID}`);
  const exportItems = (exportBoard.body.items ?? []) as Array<Record<string, unknown>>;
  const gearCards = exportItems.filter((i) => i.itemType === "gear");
  const dayBlocks = exportItems.filter((i) => i.itemType === "day").sort((a, b) => (a.y as number) - (b.y as number));
  check("16. export sees all cards", gearCards.length === 5);
  check("16b. export sees both days in the ACCEPTED board order (Day 2 first)", (dayBlocks[0]?.label as string)?.startsWith("Day 2"));
  check(
    "16c. every agent card carries its reasoning",
    gearCards.filter((i) => i.addedBy === "agent").every((i) => typeof i.note === "string" && (i.note as string).length > 0),
  );

  // ── 17. Clean up so re-runs start fresh ──────────────────────────────────
  const reset = await api("/api/brief/reset", json({ sessionId: SESSION_ID }));
  check("17. reset for the next run", reset.ok);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Loop verification crashed:", error);
  process.exit(1);
});
