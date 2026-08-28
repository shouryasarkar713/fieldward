/**
 * End-to-end verification of the Fieldward WebMCP tool surface.
 *
 * Runs the exact tool definitions that McpProvider registers with
 * document.modelContext, executes each one against the live server, and
 * checks the register/unregister contract with a mock model context.
 *
 * Weather note: Open-Meteo's anonymous tier is IP-rate-limited, and the IP
 * this harness runs behind may exhaust its daily quota. The three
 * dataSource states are therefore verified as a CONTRACT: the deterministic
 * unavailable paths are asserted outright; the forecast and
 * historical-average paths accept either the live result or a clean
 * service-unavailable fallback, logging which occurred; and the parsing /
 * averaging / gap logic is covered deterministically via fixture calls into
 * the pure functions (src/lib/weather.ts) below.
 *
 * Usage:
 *   bun run dev            # in another terminal (server must be up)
 *   bun run scripts/verify-mcp.ts
 */
import {
  buildToolDefinitions,
  FIELDWARD_TOOL_NAMES,
  registerFieldwardTools,
  unregisterFieldwardTools,
  type WebMCToolDefinition,
} from "../src/lib/mcp-tools";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../src/lib/board-geometry";
import { computeTripReadiness } from "../src/lib/trip-readiness";
import { mergeReadinessWithWeather } from "../src/lib/weather";
import {
  buildForecastOutlook,
  buildHistoricalOutlook,
  chooseWeatherSource,
  incompleteOutlookReason,
  weatherCodeLabel,
  weatherGapLines,
  type DailyArchiveJson,
  type GeoPlace,
} from "../src/lib/weather";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_ID = `verify-${Date.now()}`;

// Minimal browser polyfills so the tool layer runs outside a browser:
// the tools read the session id from localStorage, push activity events
// onto window, and write to the activity log via fetch.
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => (key === "fieldward:session" ? SESSION_ID : null),
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as Record<string, unknown>).dispatchEvent = () => true;

// Resolve relative /api/... URLs against the server under test.
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

async function main() {
  console.log(`Verifying Fieldward WebMCP tools against ${BASE}\n`);

  // ── Tool surface ────────────────────────────────────────────────────────
  const tools = buildToolDefinitions();
  check("buildToolDefinitions returns 16 tools", tools.length === 16, `got ${tools.length}`);
  check(
    "tool names match the spec",
    JSON.stringify(tools.map((t) => t.name)) === JSON.stringify([...FIELDWARD_TOOL_NAMES]),
  );
  check(
    "no lock/checkout/reset tool exists",
    // "order" is deliberately NOT in this pattern: suggest_day_order creates
    // a PENDING proposal the human must accept (behaviorally asserted below
    // -- the board does not move until the human resolves it); "order" here
    // would mean commerce/payment semantics.
    !tools.some((t) => /lock|finali[sz]|export|checkout|payment|buy|reset|clear/i.test(t.name)),
    "found a human-only action exposed as a tool — this must never happen",
  );
  check(
    "every tool declares an object inputSchema",
    tools.every((t) => t.inputSchema?.type === "object"),
  );

  const byName = new Map<string, WebMCToolDefinition>(tools.map((t) => [t.name, t]));
  const exec = async (name: string, input: Record<string, unknown>) =>
    (await byName.get(name)!.execute(input)) as Record<string, unknown>;

  // ── search_gear ──────────────────────────────────────────────────────────
  const search = await exec("search_gear", { query: "waterproof boots", limit: 10 });
  check("search_gear succeeds", search.success === true);
  const results = (search.results ?? []) as Array<Record<string, unknown>>;
  check("search finds waterproof footwear", results.length >= 2, `got ${results.length}`);
  check(
    "search results carry prices, tags, availability",
    typeof results[0]?.priceDisplay === "string" &&
      Array.isArray(results[0]?.tags) &&
      typeof results[0]?.availability === "string",
  );

  // ── filter_gear ──────────────────────────────────────────────────────────
  const filter = await exec("filter_gear", { category: "Shelter", tags: ["ultralight"] });
  check("filter_gear succeeds", filter.success === true);
  check(
    "filter returns only Shelter ultralight items",
    ((filter.results ?? []) as Array<Record<string, unknown>>).every(
      (r) => r.category === "Shelter" && (r.tags as string[]).includes("ultralight"),
    ),
  );

  // ── get_gear_details ─────────────────────────────────────────────────────
  const talusId = results.find((r) => r.name === "Talus GTX Hiking Boots")?.id as string | undefined;
  check("search surfaced Talus GTX Hiking Boots", talusId !== undefined);
  if (talusId === undefined) {
    console.log(`\nRESULT: ${passed} passed, ${failed} failed — aborting (no Talus id)`);
    process.exit(1);
  }
  const detail = await exec("get_gear_details", { gearItemId: talusId });
  check("get_gear_details succeeds", detail.success === true);
  check(
    "details include description and availability",
    typeof (detail.gear as Record<string, unknown>)?.description === "string" &&
      typeof (detail.gear as Record<string, unknown>)?.availability === "string",
  );

  // ── compare_gear ─────────────────────────────────────────────────────────
  const cairn = await exec("search_gear", { query: "Cairn", limit: 1 });
  const cairnId = ((cairn.results ?? []) as Array<Record<string, unknown>>)[0]?.id as string;
  const compare = await exec("compare_gear", { gearItemIds: [talusId!, cairnId] });
  check("compare_gear succeeds", compare.success === true);
  check("compare returns 2 items", (compare.gear as unknown[]).length === 2);

  // ── board round-trip (attribution + note + default placement) ────────────
  const NOTE = "I picked this over the cheaper pair — better rain rating for your trip.";
  const boardBefore = await exec("get_board_state", {});
  check("get_board_state succeeds", boardBefore.success === true);
  const beforeCount = boardBefore.itemCount as number;

  const place = await exec("place_on_board", { gearItemId: talusId!, note: NOTE });
  check("place_on_board (no coords) succeeds", place.success === true);
  const placedItem = place.item as Record<string, unknown>;
  check(
    'place_on_board hardcodes addedBy: "agent"',
    placedItem?.addedBy === "agent",
    `got ${placedItem?.addedBy}`,
  );
  check("place_on_board persists the note", placedItem?.note === NOTE, `got ${placedItem?.note}`);
  check(
    "server chose an in-bounds default position",
    typeof placedItem?.x === "number" &&
      typeof placedItem?.y === "number" &&
      placedItem.x >= 0 && placedItem.x < BOARD_WIDTH &&
      placedItem.y >= 0 && placedItem.y < BOARD_HEIGHT,
    `got (${placedItem?.x}, ${placedItem?.y})`,
  );

  const boardAfterPlace = await exec("get_board_state", {});
  check(
    "board grew by the agent card",
    (boardAfterPlace.itemCount as number) === beforeCount + 1,
  );
  const agentCard = ((boardAfterPlace.items ?? []) as Array<Record<string, unknown>>).find(
    (i) => i.gearItemId === talusId,
  );
  check("get_board_state shows the agent card with its note", agentCard?.note === NOTE);

  // Explicit coordinates (clamped into the board).
  const placeAt = await exec("place_on_board", { gearItemId: cairnId, x: 500, y: 300 });
  check("place_on_board with explicit coords succeeds", placeAt.success === true);
  const placedAt = placeAt.item as Record<string, unknown>;
  check("explicit coordinates respected", placedAt?.x === 500 && placedAt?.y === 300, `got (${placedAt?.x}, ${placedAt?.y})`);

  const placeWayOut = await exec("place_on_board", { gearItemId: cairnId, x: 99_999, y: 99_999 });
  const placedWayOut = placeWayOut.item as Record<string, unknown>;
  check(
    "out-of-bounds coordinates clamped to the board",
    placeWayOut.success === true &&
      (placedWayOut?.x as number) <= BOARD_WIDTH && (placedWayOut?.y as number) <= BOARD_HEIGHT,
  );

  // ── move_board_item ──────────────────────────────────────────────────────
  const move = await exec("move_board_item", {
    boardItemId: agentCard!.id as string,
    x: 720,
    y: 260,
  });
  check("move_board_item succeeds", move.success === true);
  const movedItem = move.item as Record<string, unknown>;
  check("move applied the new position", movedItem?.x === 720 && movedItem?.y === 260);

  // ── remove_from_board ────────────────────────────────────────────────────
  const removeAt = await exec("remove_from_board", { boardItemId: placedAt?.id as string });
  check("remove_from_board succeeds", removeAt.success === true);
  const removeWayOut = await exec("remove_from_board", { boardItemId: placedWayOut?.id as string });
  check("remove_from_board (clamped card) succeeds", removeWayOut.success === true);
  const boardAfterRemove = await exec("get_board_state", {});
  check(
    "board is back to its starting size + 1 (Talus still on it)",
    (boardAfterRemove.itemCount as number) === beforeCount + 1,
  );

  // ── trip brief: read → propose (pending!) → accept → propose → dismiss ────
  const briefNone = await exec("get_trip_brief", {});
  check("get_trip_brief succeeds with nothing set", briefNone.success === true && briefNone.brief === null);

  const propose = await exec("propose_trip_brief_update", {
    tripDescription: "3-day winter backpacking trip in the Cascades",
    budget: 400,
  });
  check("propose_trip_brief_update succeeds", propose.success === true);
  const proposed = propose.brief as Record<string, unknown>;
  check("proposal stored as pending", proposed?.pendingProposal !== null && proposed?.pendingProposal !== undefined);
  check(
    "proposal does NOT overwrite the live brief",
    proposed?.tripDescription === "",
    `got "${proposed?.tripDescription}" — proposals must stay pending`,
  );
  const pending = proposed?.pendingProposal as Record<string, unknown>;
  check("proposal stores budget in cents ($400)", pending?.budget === 40000);

  // Human accepts (direct API call — the UI path).
  const acceptResponse = await originalFetch(`${BASE}/api/brief/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, decision: "accept" }),
  });
  check("human accepts via the API", acceptResponse.ok);
  const afterAccept = (await acceptResponse.json()) as { brief: Record<string, unknown> };
  check("accept applies the trip description", afterAccept.brief?.tripDescription === "3-day winter backpacking trip in the Cascades");
  check("accept applies the budget", afterAccept.brief?.budget === 40000);
  check("accept clears the pending proposal", afterAccept.brief?.pendingProposal === null);

  // A second proposal, then dismissed: values must NOT change.
  const propose2 = await exec("propose_trip_brief_update", { budget: 550 });
  check("second proposal lands pending", (propose2.brief as Record<string, unknown>)?.pendingProposal !== null);
  const dismissResponse = await originalFetch(`${BASE}/api/brief/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, decision: "dismiss" }),
  });
  const afterDismiss = (await dismissResponse.json()) as { brief: Record<string, unknown> };
  check("dismiss leaves the human's budget untouched", afterDismiss.brief?.budget === 40000);
  check("dismiss clears the pending proposal", afterDismiss.brief?.pendingProposal === null);

  // Agent cannot edit the brief directly — the update route is human-only.
  const directAgentEdit = await originalFetch(`${BASE}/api/brief/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      tripDescription: "agent wrote this directly",
      budget: 100,
      updatedBy: "agent",
    }),
  });
  check("agent cannot edit the brief directly (403)", directAgentEdit.status === 403);

  // Agent cannot author day blocks either — human structure, agent arrangement.
  const agentDay = await originalFetch(`${BASE}/api/board/place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, itemType: "day", label: "Day 1", addedBy: "agent" }),
  });
  check("agent cannot create day blocks (403)", agentDay.status === 403);

  // ── check_trip_readiness: winter trip, board with waterproof footwear ────
  const readiness = await exec("check_trip_readiness", {});
  check("check_trip_readiness succeeds", readiness.success === true);
  check("check_trip_readiness matched the winter trip", readiness.matched === true && readiness.trip === "a winter backpacking trip");
  check(
    "footwear requirement satisfied by the board",
    ((readiness.covered as string[]) ?? []).some((c) => c.includes("footwear")),
  );
  check(
    "cook gear reported missing",
    ((readiness.gaps as string[]) ?? []).includes("no cook gear on the board"),
  );
  check(
    "check_trip_readiness is analysis-only (board unchanged)",
    ((await exec("get_board_state", {})).itemCount as number) === beforeCount + 1,
  );

  // ── mark_item_owned (matched catalog + custom personal gear) ────────────
  const boardBeforeOwned = await exec("get_board_state", {});
  const budgetBeforeOwned = boardBeforeOwned.gearTotalCents as number;

  // 1. Matched catalog item
  const markCatalog = await exec("mark_item_owned", { name: "Nightfall 20° Sleeping Bag", note: "I already have this sleeping bag" });
  check("mark_item_owned (catalog match) succeeds", markCatalog.success === true);
  check("matchedExisting is true for catalog item", markCatalog.matchedExisting === true);
  const catalogItem = markCatalog.item as Record<string, unknown>;
  check("item ownership is 'owned'", catalogItem?.ownership === "owned");
  check("item placed by agent", catalogItem?.addedBy === "agent");
  check("item placed in top 'Already have' zone", (catalogItem?.y as number) < 380, `y=${catalogItem?.y}`);

  // Budget impact test: owned item must NOT increase gearTotalCents
  const boardAfterCatalog = await exec("get_board_state", {});
  check(
    "owned gear does NOT consume trip acquisition budget ($0 impact)",
    boardAfterCatalog.gearTotalCents === budgetBeforeOwned,
    `before=${budgetBeforeOwned} after=${boardAfterCatalog.gearTotalCents}`,
  );
  check(
    "board item count grew by 1",
    (boardAfterCatalog.itemCount as number) === (boardBeforeOwned.itemCount as number) + 1,
  );

  // Readiness test: owned item satisfies requirements
  const readinessAfterOwned = await exec("check_trip_readiness", {});
  check(
    "owned tent satisfies the winter-rated sleep system requirement",
    ((readinessAfterOwned.covered as string[]) ?? []).some((c) => c.includes("sleep system")),
    JSON.stringify(readinessAfterOwned.covered),
  );

  // 2. Custom non-catalog item
  const markCustom = await exec("mark_item_owned", {
    name: "Grandpa's Vintage Compass",
    category: "Navigation",
    note: "Inherited heirloom",
  });
  check("mark_item_owned (custom gear) succeeds", markCustom.success === true);
  check("matchedExisting is false for non-catalog item", markCustom.matchedExisting === false);
  const customItem = markCustom.item as Record<string, unknown>;
  check("custom item ownership is 'owned'", customItem?.ownership === "owned");
  check("custom item placed in top zone", (customItem?.y as number) < 380);


  // ── weather grounding: the three honest states ──────────────────────────
  // The brief at this point has a trip description and budget but NO place
  // or dates — the first state is "unavailable, tell me where and when".
  const weatherNone = await exec("get_weather_outlook", {});
  check("get_weather_outlook succeeds with nothing set", weatherNone.success === true);
  check(
    "outlook is unavailable before place/dates are set",
    weatherNone.dataSource === "unavailable" && typeof weatherNone.reason === "string",
    JSON.stringify(weatherNone),
  );
  check(
    "unavailable reason points at the missing fields",
    /place|dates/i.test(String(weatherNone.reason)),
  );
  check(
    "unavailable outlook hints at asking the human",
    typeof weatherNone.hint === "string" && /ask the human/i.test(String(weatherNone.hint)),
  );

  // Human sets a place that doesn't geocode → honest unavailable, not an error.
  const setBrief = async (location: string, startDate: string, endDate: string) =>
    originalFetch(`${BASE}/api/brief/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        tripDescription: "3-day winter backpacking trip in the Cascades",
        budget: 40000,
        location,
        startDate,
        endDate,
        updatedBy: "human",
      }),
    });

  const badPlaceSet = await setBrief("Xyzzyq Nowherevale", "2026-11-15", "2026-11-18");
  check("human set an unfindable place (brief saved)", badPlaceSet.ok);
  const weatherBadPlace = await exec("get_weather_outlook", {});
  check(
    "unfindable place → unavailable with a clear reason",
    weatherBadPlace.dataSource === "unavailable" && /couldn.t find/i.test(String(weatherBadPlace.reason)),
    JSON.stringify(weatherBadPlace),
  );

  // Past dates → unavailable (nothing to plan against).
  const pastDates = await setBrief("North Cascades", "2026-01-10", "2026-01-12");
  check("human set past dates (brief saved)", pastDates.ok);
  const weatherPast = await exec("get_weather_outlook", {});
  check(
    "past dates → unavailable saying they're in the past",
    weatherPast.dataSource === "unavailable" && /past/i.test(String(weatherPast.reason)),
    JSON.stringify(weatherPast),
  );

  // Far-future dates (beyond Open-Meteo's ~16-day forecast horizon) →
  // EITHER a live seasonal average OR an honest service-unavailable.
  // Shared IPs frequently exhaust the anonymous quota; both
  // outcomes satisfy the contract. (Log which one occurred.)
  const farSet = await setBrief("North Cascades", "2026-11-15", "2026-11-18");
  check("human set a far-future trip window (brief saved)", farSet.ok);
  const weatherFar = await exec("get_weather_outlook", {});
  const farIsAverage =
    weatherFar.dataSource === "historical-average" &&
    Array.isArray(weatherFar.days) &&
    weatherFar.days.length === 4 &&
    typeof weatherFar.summary === "string" &&
    /seasonal average/i.test(String(weatherFar.summary)) &&
    typeof weatherFar.sampledYears === "number" &&
    weatherFar.sampledYears >= 1;
  const farIsUnavailable =
    weatherFar.dataSource === "unavailable" && /unreachable|rate-limited|couldn.t find/i.test(String(weatherFar.reason));
  console.log(
    farIsAverage
      ? "     (live: Open-Meteo archive reachable — seasonal average verified against real data)"
      : "     (upstream unavailable right now — seasonal-average DATA path covered by fixtures below)",
  );
  check(
    "far-future outlook is a seasonal average or an honest unavailable",
    (weatherFar.success === true && farIsAverage) || farIsUnavailable,
    JSON.stringify(weatherFar),
  );

  // Near-future dates (inside the horizon) → real forecast or honest
  // unavailable, same reasoning.
  const nearSet = await setBrief("North Cascades", "2026-09-05", "2026-09-07");
  check("human set a near-future trip window (brief saved)", nearSet.ok);
  const weatherNear = await exec("get_weather_outlook", {});
  const nearDays = (weatherNear.days ?? []) as Array<Record<string, unknown>>;
  const nearIsForecast =
    weatherNear.dataSource === "forecast" &&
    nearDays.length === 3 &&
    typeof weatherNear.summary === "string" &&
    nearDays.every(
      (day) =>
        typeof day.tempMaxC === "number" &&
        typeof day.tempMinC === "number" &&
        (day.precipChancePct === null || typeof day.precipChancePct === "number") &&
        (day.condition === null || typeof day.condition === "string"),
    );
  const nearIsUnavailable =
    weatherNear.dataSource === "unavailable" && /unreachable|rate-limited|couldn.t find/i.test(String(weatherNear.reason));
  console.log(
    nearIsForecast
      ? "     (live: Open-Meteo forecast reachable — real forecast verified)"
      : "     (upstream unavailable right now — forecast DATA path covered by fixtures below)",
  );
  check(
    "near-future outlook is a real forecast or an honest unavailable",
    (weatherNear.success === true && nearIsForecast) || nearIsUnavailable,
    JSON.stringify(weatherNear),
  );

  // The readiness fold: one coherent result with the weather grounding in it.
  const readinessWeather = await exec("check_trip_readiness", {});
  check(
    "check_trip_readiness carries the weather grounding",
    readinessWeather.success === true &&
      typeof readinessWeather.weather === "object" &&
      readinessWeather.weather !== null,
  );
  check(
    "readiness weather state matches the outlook state",
    (readinessWeather.weather as Record<string, unknown>)?.dataSource === weatherNear.dataSource,
    `readiness=${JSON.stringify(readinessWeather.weather)} outlook=${weatherNear.dataSource}`,
  );
  if (nearIsForecast) {
    const rainyDay = nearDays.some(
      (day) => (typeof day.precipChancePct === "number" && day.precipChancePct >= 50) ||
        (typeof day.precipSumMm === "number" && day.precipSumMm >= 1),
    );
    const freezingNight = nearDays.some((day) => typeof day.tempMinC === "number" && day.tempMinC <= 0);
    // The board holds waterproof footwear (Talus) but nothing winter-rated.
    if (rainyDay || freezingNight) {
      const foldGaps = (readinessWeather.gaps ?? []) as string[];
      const foldCovered = (readinessWeather.covered ?? []) as string[];
      check(
        "readiness folds the live weather signal into gaps/covered",
        foldGaps.some((gap) => gap.includes("no board item tagged")) ||
          foldCovered.some((entry) => /waterproof|winter-rated/.test(entry)),
      );
    } else {
      console.log("     (live forecast carried no rain/freeze signal — fold verified by fixtures instead)");
    }
  }

  // ── compare_trip_dates: multi-date hypothetical preview ─────────────────
  const dateCompare = await exec("compare_trip_dates", {
    dateRanges: [
      { startDate: "2026-09-05", endDate: "2026-09-07", label: "Option 1: Early Sept" },
      { startDate: "2026-11-15", endDate: "2026-11-18", label: "Option 2: Mid Nov" },
    ],
  });
  check("compare_trip_dates succeeds", dateCompare.success === true);
  check("returns comparisonCount of 2", dateCompare.comparisonCount === 2);
  const comparisons = (dateCompare.comparisons ?? []) as Array<{
    startDate: string;
    endDate: string;
    weather: { dataSource: string };
    readiness: { totalRequirements: number };
  }>;
  check("comparisons array has 2 elements", comparisons.length === 2);
  check(
    "each range has its own independent weather outlook and readiness",
    comparisons[0] !== undefined &&
      typeof comparisons[0].weather.dataSource === "string" &&
      typeof comparisons[1]?.weather.dataSource === "string",
    JSON.stringify(comparisons),
  );

  // Partial failure test: one valid range, one past range
  const partialCompare = await exec("compare_trip_dates", {
    dateRanges: [
      { startDate: "2026-09-05", endDate: "2026-09-07" },
      { startDate: "2020-01-01", endDate: "2020-01-03" }, // past
    ],
  });
  check("compare_trip_dates handles partial range issues without crashing", partialCompare.success === true);
  const partialList = (partialCompare.comparisons ?? []) as Array<{ weather: { dataSource: string } }>;
  check(
    "past date range returns honest unavailable without breaking the batch",
    partialList[1]?.weather.dataSource === "unavailable",
  );

  // Validation errors
  const badCompare1 = await exec("compare_trip_dates", { dateRanges: [{ startDate: "2026-09-01", endDate: "2026-09-02" }] });
  check("compare_trip_dates rejects single range (<2)", badCompare1.success === false);
  const badCompare4 = await exec("compare_trip_dates", {
    dateRanges: [
      { startDate: "2026-09-01", endDate: "2026-09-02" },
      { startDate: "2026-09-03", endDate: "2026-09-04" },
      { startDate: "2026-09-05", endDate: "2026-09-06" },
      { startDate: "2026-09-07", endDate: "2026-09-08" },
    ],
  });
  check("compare_trip_dates rejects >3 ranges", badCompare4.success === false);

  // ── weather: pure-function fixtures (deterministic, no upstream) ─────────
  // Real Open-Meteo response shapes, run through the same builders the
  // server uses — this is the full-coverage path for the forecast and
  // seasonal-average data shapes regardless of upstream availability.
  const geo: GeoPlace = {
    name: "North Cascades National Park",
    region: "Washington",
    country: "United States",
    latitude: 48.83,
    longitude: -121.35,
  };

  const forecastFixture = buildForecastOutlook(geo, {
    time: ["2026-09-02", "2026-09-03"],
    weather_code: [0, 63],
    temperature_2m_max: [21.4, 14.2],
    temperature_2m_min: [7.1, 3.8],
    precipitation_sum: [0, 6.2],
    precipitation_probability_max: [10, 80],
  });
  check("fixture: forecast outlook parses both days", forecastFixture.days.length === 2);
  check(
    "fixture: WMO codes become condition labels",
    forecastFixture.days[0].condition === "Clear sky" && forecastFixture.days[1].condition === "Rain",
  );
  check("fixture: forecast carries precipitation chance", forecastFixture.days[1].precipChancePct === 80);
  check(
    "fixture: forecast summary counts the rainy day",
    /Rain likely on 1 of 2 days/.test(forecastFixture.summary) && /21°C/.test(forecastFixture.summary),
  );

  const historicalFixture = buildHistoricalOutlook(geo, "2026-11-15", "2026-11-16", [
    { year: 2025, daily: { time: ["2025-11-15", "2025-11-16"], temperature_2m_max: [4, 6], temperature_2m_min: [-3, -1], precipitation_sum: [8.5, 2] } },
    { year: 2024, daily: { time: ["2024-11-15", "2024-11-16"], temperature_2m_max: [2, 4], temperature_2m_min: [-5, -3], precipitation_sum: [1.5, 3] } },
  ]);
  check(
    "fixture: historical outlook averages the years per trip-day",
    historicalFixture.days.length === 2 &&
      historicalFixture.days[0].tempMaxC === 3 &&
      historicalFixture.days[0].tempMinC === -4 &&
      historicalFixture.days[0].precipSumMm === 5,
    JSON.stringify(historicalFixture.days),
  );
  check("fixture: historical outlook counts its sampled years", historicalFixture.sampledYears === 2);
  check(
    "fixture: historical summary says it's a seasonal average",
    /seasonal average/.test(historicalFixture.summary),
  );
  const historicalShort = buildHistoricalOutlook(geo, "2026-02-28", "2026-03-01", [
    { year: 2025, daily: { time: ["2025-11-15", "2025-11-16"], temperature_2m_max: [4, 6], temperature_2m_min: [-3, -1], precipitation_sum: [8.5, 2] } },
    { year: 2024, daily: { time: ["2024-02-28"], temperature_2m_max: [2], temperature_2m_min: [-5], precipitation_sum: [1.5] } },
  ]);
  check(
    "fixture: historical average caps to the shortest year window (Feb 29 clamp)",
    historicalShort.days.length === 1 && historicalShort.sampledYears === 2,
  );

  check("fixture: classifier — past window", chooseWeatherSource("2026-09-01", "2026-09-02", "2026-09-10") === "past");
  check("fixture: classifier — within the forecast horizon", chooseWeatherSource("2026-09-10", "2026-09-20", "2026-09-10") === "forecast");
  check("fixture: classifier — beyond the horizon", chooseWeatherSource("2026-10-15", "2026-10-18", "2026-09-10") === "historical-average");
  check("fixture: classifier — underway trip ending inside the horizon", chooseWeatherSource("2026-09-05", "2026-09-15", "2026-09-10") === "forecast");
  check("fixture: classifier — incomplete window", chooseWeatherSource(null, "2026-09-15", "2026-09-10") === "incomplete");
  check(
    "fixture: incomplete reasons name what's missing",
    incompleteOutlookReason(null, null, null) !== null &&
      incompleteOutlookReason(null, null, null)!.includes("place") &&
      incompleteOutlookReason("Somewhere", "2026-01-01", "2026-01-01") === null,
  );

  const cookLine = { category: "Cook Gear", tags: [] as string[] };
  const rainGaps = weatherGapLines(forecastFixture, [cookLine]);
  check(
    "fixture: rain gap fires without waterproof gear",
    rainGaps.gaps.some((gap) => gap.includes("rain likely on day 2") && gap.includes("waterproof")),
    JSON.stringify(rainGaps.gaps),
  );
  check(
    "fixture: rain gap becomes covered with waterproof gear",
    weatherGapLines(forecastFixture, [{ category: "Footwear", tags: ["waterproof"] }]).covered.some((entry) =>
      entry.includes("waterproof"),
    ),
  );
  const coldGaps = weatherGapLines(historicalFixture, [cookLine]);
  check(
    "fixture: cold gap fires without winter-rated gear",
    coldGaps.gaps.some((gap) => gap.includes("winter-rated")),
    JSON.stringify(coldGaps.gaps),
  );
  check(
    "fixture: cold gap becomes covered with winter-rated gear",
    weatherGapLines(historicalFixture, [{ category: "Shelter", tags: ["winter-rated"] }]).covered.some((entry) =>
      entry.includes("winter-rated"),
    ),
  );
  check(
    "fixture: unavailable outlook yields no weather gaps",
    weatherGapLines({ dataSource: "unavailable", reason: "nope" }, [cookLine]).gaps.length === 0,
  );
  check(
    "fixture: WMO label table",
    weatherCodeLabel(0) === "Clear sky" && weatherCodeLabel(63) === "Rain" && weatherCodeLabel(95) === "Thunderstorm" && weatherCodeLabel(null) === null,
  );

  // The readiness merge, on fixtures: archetype gaps + weather gaps, one array.
  const mergedFixture = mergeReadinessWithWeather(
    computeTripReadiness([cookLine], "3-day winter backpacking trip in the Cascades"),
    forecastFixture,
    [cookLine],
  );
  check(
    "fixture: merge appends the weather gap after the archetype gaps",
    mergedFixture.gaps.length === 4 && mergedFixture.gaps[3].includes("rain likely on day 2"),
    JSON.stringify(mergedFixture.gaps),
  );
  check("fixture: merge carries the weather grounding", mergedFixture.weather.dataSource === "forecast");

  // ── suggest_day_order: propose → (nothing moves) → accept/dismiss ────────
  const dayAt = async (label: string, x: number, y: number) => {
    const response = await originalFetch(`${BASE}/api/board/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, itemType: "day", label, addedBy: "human", x, y }),
    });
    const body = (await response.json()) as { item: { id: string } };
    return body.item.id;
  };
  const dayA = await dayAt("Day 1 - Trailhead to Cairn Lake", 64, 64);
  const dayB = await dayAt("Day 2 - Cairn Lake to The Saddle", 64, 300);
  const dayC = await dayAt("Day 3 - Saddle to Summit", 64, 540);
  check("human authored three day blocks for the day-order section", [dayA, dayB, dayC].every((id) => id.length > 0));

  const suggest = await exec("suggest_day_order", {
    orderedBoardItemIds: [dayC, dayB, dayA],
    note: "The pass is calmer early - summit day first.",
  });
  check("suggest_day_order succeeds", suggest.success === true);
  check("suggest_day_order returns the pending proposal", JSON.stringify(suggest.proposal).includes(dayC));
  check("suggest_day_order returns the current order for reference", Array.isArray(suggest.currentOrder) && suggest.currentOrder.length === 3);

  const boardWithProposal = await exec("get_board_state", {});
  check(
    "get_board_state exposes the pending day-order proposal",
    JSON.stringify(boardWithProposal.pendingDayOrder).includes(dayC) &&
      JSON.stringify(boardWithProposal.pendingDayOrder).includes("calmer early"),
  );
  const dayItems = ((boardWithProposal.items ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.itemType === "day",
  );
  const yOf = (id: string) => dayItems.find((item) => item.id === id)?.y as number;
  check(
    "the proposal did NOT move anything (day 1 still first)",
    yOf(dayA) < yOf(dayB) && yOf(dayB) < yOf(dayC),
    `y: A=${yOf(dayA)} B=${yOf(dayB)} C=${yOf(dayC)}`,
  );

  // Invalid inputs — every one must be refused, nothing pending overwritten.
  const badSuggestEmpty = await exec("suggest_day_order", { orderedBoardItemIds: [] });
  check("empty id list returns success:false", badSuggestEmpty.success === false);
  const badSuggestOne = await exec("suggest_day_order", { orderedBoardItemIds: [dayA] });
  check("single-day order returns success:false", badSuggestOne.success === false);
  const badSuggestDupes = await exec("suggest_day_order", { orderedBoardItemIds: [dayA, dayA] });
  check("duplicate ids return success:false", badSuggestDupes.success === false);
  const badSuggestGear = await exec("suggest_day_order", { orderedBoardItemIds: [agentCard!.id as string, dayB] });
  check("a gear card id is rejected", badSuggestGear.success === false);
  const badSuggestUnknown = await exec("suggest_day_order", { orderedBoardItemIds: ["nope-1", "nope-2"] });
  check("unknown ids are rejected", badSuggestUnknown.success === false);
  const badSuggestPartial = await exec("suggest_day_order", { orderedBoardItemIds: [dayA, dayB] });
  check("a partial set (2 of 3 days) is rejected", badSuggestPartial.success === false);
  const badSuggestNote = await exec("suggest_day_order", {
    orderedBoardItemIds: [dayC, dayB, dayA],
    note: "x".repeat(300),
  });
  check("a 300-char note returns success:false", badSuggestNote.success === false);
  check(
    "the valid proposal is still the one pending after all the rejections",
    JSON.stringify((await exec("get_board_state", {})).pendingDayOrder).includes("calmer early"),
  );

  // Human accepts → slot reassignment: same positions, new reading order.
  const acceptOrder = await originalFetch(`${BASE}/api/board/day-order/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, decision: "accept" }),
  });
  check("human accepts the day order via the API (no tool exists for this)", acceptOrder.ok);
  const acceptedBoard = (await acceptOrder.json()) as {
    movedCount: number;
    items: Array<{ id: string; itemType: string; y: number; x: number; label: string }>;
  };
  check("accept moved exactly the two blocks that trade places", acceptedBoard.movedCount === 2, `got ${acceptedBoard.movedCount}`);
  const acceptedDays = acceptedBoard.items.filter((item) => item.itemType === "day").sort((a, b) => a.y - b.y || a.x - b.x);
  check(
    "the board now reads Day 3 → Day 2 → Day 1 top to bottom",
    acceptedDays.map((day) => day.label.slice(0, 5)).join("|") === "Day 3|Day 2|Day 1",
    acceptedDays.map((day) => day.label.slice(0, 5)).join("|"),
  );
  check(
    "the accepted layout kept the same three slot positions",
    JSON.stringify(acceptedDays.map((day) => [day.x, day.y])) === JSON.stringify([[64, 64], [64, 300], [64, 540]]),
  );
  check(
    "proposal cleared after the verdict",
    (await exec("get_board_state", {})).pendingDayOrder === null,
  );

  // Second proposal, dismissed: positions must not change.
  const suggestAgain = await exec("suggest_day_order", { orderedBoardItemIds: [dayA, dayB, dayC] });
  check("second day-order suggestion lands pending", suggestAgain.success === true);
  const dismissOrder = await originalFetch(`${BASE}/api/board/day-order/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, decision: "dismiss" }),
  });
  check("human dismisses the second suggestion", dismissOrder.ok);
  const dismissedBoard = (await dismissOrder.json()) as {
    items: Array<{ id: string; itemType: string; y: number }>;
  };
  const dismissedDays = dismissedBoard.items.filter((item) => item.itemType === "day").sort((a, b) => a.y - b.y);
  check(
    "dismiss left the accepted order untouched",
    dismissedDays.map((day) => day.id).join("|") === [dayC, dayB, dayA].join("|"),
    dismissedDays.map((day) => day.id).join("|"),
  );
  check("dismiss cleared the proposal too", (await exec("get_board_state", {})).pendingDayOrder === null);

  // ── activity log: agent tool calls + human events, newest first ──────────
  const humanLog = await originalFetch(`${BASE}/api/activity/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      actor: "human",
      action: "view_gear",
      detail: "You viewed Talus GTX Hiking Boots.",
    }),
  });
  check("human event written to the log", humanLog.ok);

  const activity = await exec("get_activity_log", { limit: 100 });
  check("get_activity_log succeeds", activity.success === true);
  const events = (activity.events ?? []) as Array<Record<string, unknown>>;
  check("activity log has events", events.length > 0, `got ${events.length}`);
  check(
    "log records agent tool calls (place_on_board)",
    events.some((e) => e.action === "tool:place_on_board"),
  );
  check(
    "log records the human view (quiet, but visible to the agent)",
    events.some((e) => e.actor === "human" && e.action === "view_gear"),
  );
  check(
    "log is newest-first",
    events.length < 2 || Date.parse(events[0].at as string) >= Date.parse(events[1].at as string),
  );

  // ── error handling (never throws; returns success:false) ─────────────────
  const badPlace = await exec("place_on_board", {});
  check("place_on_board with no gearItemId returns success:false", badPlace.success === false);
  const badMove = await exec("move_board_item", { boardItemId: "whatever" });
  check("move_board_item without x/y returns success:false", badMove.success === false);
  const badUnknown = await exec("place_on_board", { gearItemId: "nonexistent-id" });
  check("place_on_board with unknown id returns success:false", badUnknown.success === false);
  const badNote = await exec("place_on_board", { gearItemId: talusId!, note: "x".repeat(300) });
  check("place_on_board with a 300-char note returns success:false", badNote.success === false);
  const badHalfCoords = await exec("place_on_board", { gearItemId: talusId!, x: 100 });
  check("place_on_board with x but no y returns success:false", badHalfCoords.success === false);
  const badCompare = await exec("compare_gear", { gearItemIds: [talusId!] });
  check("compare with 1 id returns success:false", badCompare.success === false);
  const badPropose = await exec("propose_trip_brief_update", {});
  check("propose_trip_brief_update with no fields returns success:false", badPropose.success === false);
  const badBudget = await exec("propose_trip_brief_update", { budget: -5 });
  check("propose with a negative budget returns success:false", badBudget.success === false);

  // ── the lock boundary: human locks, every agent mutation dies ────────────
  const lockResponse = await originalFetch(`${BASE}/api/brief/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
  check("human locks the plan via the API (no tool exists for this)", lockResponse.ok);

  const lockedBoard = await exec("get_board_state", {});
  check("get_board_state reports locked: true", lockedBoard.locked === true);
  check("reads still succeed while locked", lockedBoard.success === true);

  const placeLocked = await exec("place_on_board", { gearItemId: talusId! });
  check("place_on_board refused while locked", placeLocked.success === false, JSON.stringify(placeLocked));
  const markOwnedLocked = await exec("mark_item_owned", { name: "Hollowpine 2P Tent" });
  check("mark_item_owned refused while locked", markOwnedLocked.success === false);
  const moveLocked = await exec("move_board_item", {
    boardItemId: agentCard!.id as string,
    x: 10,
    y: 10,
  });
  check("move_board_item refused while locked", moveLocked.success === false);
  const removeLocked = await exec("remove_from_board", { boardItemId: agentCard!.id as string });
  check("remove_from_board refused while locked", removeLocked.success === false);
  const proposeLocked = await exec("propose_trip_brief_update", { budget: 900 });
  check("propose_trip_brief_update refused while locked", proposeLocked.success === false);
  const suggestLocked = await exec("suggest_day_order", { orderedBoardItemIds: [dayA, dayB, dayC] });
  check("suggest_day_order refused while locked", suggestLocked.success === false);

  // Read-only tools still succeed while locked
  const compareDatesLocked = await exec("compare_trip_dates", {
    dateRanges: [
      { startDate: "2026-09-01", endDate: "2026-09-02" },
      { startDate: "2026-09-03", endDate: "2026-09-04" },
    ],
  });
  check("compare_trip_dates succeeds while locked (read-only preview)", compareDatesLocked.success === true);

  // Human starts a new plan (the only way out of a lock — human-only too).
  const resetResponse = await originalFetch(`${BASE}/api/brief/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
  check("human starts a new plan via the API", resetResponse.ok);
  const freshBoard = await exec("get_board_state", {});
  check("reset cleared the board", freshBoard.success === true && freshBoard.itemCount === 0);
  const placeAfterReset = await exec("place_on_board", { gearItemId: talusId! });
  check("placing works again on the fresh plan", placeAfterReset.success === true);
  const weatherAfterReset = await exec("get_weather_outlook", {});
  check(
    "reset wiped the weather grounding too (back to unset)",
    weatherAfterReset.dataSource === "unavailable" && /place|dates/i.test(String(weatherAfterReset.reason)),
  );

  // ── register/unregister contract with a mock model context ──────────────
  const registered: string[] = [];
  const unregistered: string[] = [];
  const mockContext = {
    registerTool: async (definition: WebMCToolDefinition) => {
      registered.push(definition.name);
    },
    unregisterTool: async (name: string) => {
      unregistered.push(name);
    },
  };
  await registerFieldwardTools(mockContext);
  check(
    "registerFieldwardTools registers all 16 tools individually",
    registered.length === 16 && JSON.stringify(registered) === JSON.stringify([...FIELDWARD_TOOL_NAMES]),
  );
  await unregisterFieldwardTools(mockContext);
  check(
    "unregisterFieldwardTools calls unregisterTool once per tool",
    unregistered.length === 16 && JSON.stringify(unregistered) === JSON.stringify([...FIELDWARD_TOOL_NAMES]),
  );

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
