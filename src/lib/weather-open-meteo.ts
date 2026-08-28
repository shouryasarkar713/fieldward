/**
 * The Open-Meteo client — the ONLY module that talks to the weather
 * service. No API key required (Open-Meteo's anonymous tier), which is why
 * it's the right grounding for a demo: real data, zero signup.
 *
 * Three upstream endpoints:
 *   geocoding-api.open-meteo.com/v1/search   place name → lat/lon
 *   api.open-meteo.com/v1/forecast           real forecast (≈16-day horizon)
 *   archive-api.open-meteo.com/v1/archive    ERA5 reanalysis (past weather)
 *
 * The historical average is computed, not fetched: the trip's calendar
 * window is pulled for each of the last four complete years and averaged
 * per trip-day (see DECISIONS.md). Every upstream response is cached with a
 * TTL keyed by what actually determines it, so the UI chip, the
 * get_weather_outlook tool, and check_trip_readiness hitting the same
 * window in one session cost one upstream round trip, not three.
 *
 * Upstream failures (rate limits, timeouts, malformed payloads) never throw
 * out of this module — they become honest { dataSource: "unavailable" }
 * outlooks with a reason the human and the agent both get to see.
 */

import { db } from "@/lib/db";
import { toDateOnly } from "@/lib/dates";
import {
  buildForecastOutlook,
  buildHistoricalOutlook,
  chooseWeatherSource,
  incompleteOutlookReason,
  type DailyArchiveJson,
  type DailyForecastJson,
  type GeoPlace,
} from "@/lib/weather";
import type { WeatherOutlook } from "@/lib/types";

const UPSTREAM_TIMEOUT_MS = 8_000;
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1_000; // places don't move
const FORECAST_TTL_MS = 30 * 60 * 1_000; // upstream refreshes hourly-ish
const HISTORICAL_TTL_MS = 6 * 60 * 60 * 1_000; // ERA5 is final data
const FAILURE_TTL_MS = 60 * 1_000; // don't hammer a failing upstream

/** Years averaged for a seasonal outlook — recent enough to reflect the climate, enough to smooth one odd year. */
const HISTORICAL_YEARS = 4;

type CacheEntry = { value: WeatherOutlook | GeoPlace | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): { fresh: boolean; value: T | null } {
  const entry = cache.get(key);
  if (entry === undefined || entry.expiresAt < Date.now()) return { fresh: false, value: null };
  return { fresh: true, value: entry.value as T | null };
}

function putCached(key: string, value: CacheEntry["value"], ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`upstream responded ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/* ── Geocoding ───────────────────────────────────────────────────────────── */

function normalizeGeoString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function scoreGeoCandidate(candidate: Record<string, unknown>, query: string): number {
  const normQuery = normalizeGeoString(query);
  const normName = normalizeGeoString(typeof candidate.name === "string" ? candidate.name : "");
  const normAdmin = normalizeGeoString(typeof candidate.admin1 === "string" ? candidate.admin1 : "");
  const normCountry = normalizeGeoString(typeof candidate.country === "string" ? candidate.country : "");

  let score = 0;

  // 1. Exact match on place name (e.g. "Leh" -> "Leh")
  if (normName === normQuery) score += 100;

  // 2. Word boundary match on place name (e.g. "Ladakh" -> "Ladakh Range", "Cascades" -> "North Cascades")
  if (normName.startsWith(`${normQuery} `) || normName.endsWith(` ${normQuery}`) || normName.includes(` ${normQuery} `)) {
    score += 80;
  }

  // 3. Region / State / Administrative match (e.g. "Ladakh" -> places with admin1: "Ladakh")
  if (normAdmin === normQuery) score += 75;

  // 4. Country match
  if (normCountry === normQuery) score += 40;

  // 5. Geographic features prioritization (mountains, national parks, administrative regions, populated places)
  const featureCode = typeof candidate.feature_code === "string" ? candidate.feature_code : "";
  if (["MTS", "MT", "PK", "PRK", "PPLA", "PPLC", "ADM1", "ADM2"].includes(featureCode)) {
    score += 20;
  }

  // 6. Population weight
  const population = typeof candidate.population === "number" ? candidate.population : 0;
  if (population > 500) {
    score += Math.min(25, Math.log10(population) * 5);
  }

  // 7. Penalty for prefix collisions that are completely different words (e.g. "Ladākhaman" for "Ladakh")
  if (normName !== normQuery && !normName.startsWith(`${normQuery} `) && normName.startsWith(normQuery)) {
    score -= 35;
  }

  return score;
}

async function geocode(location: string): Promise<GeoPlace | null> {
  const key = `geo:${location.toLowerCase().trim()}`;
  const cached = getCached<GeoPlace>(key);
  if (cached.fresh) return cached.value;

  let place: GeoPlace | null = null;
  try {
    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.trim())}&count=10&language=en&format=json`,
    );
    const results = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
    if (results.length > 0) {
      // Sort candidates by relevance to the human's query
      const sorted = [...results].sort(
        (a, b) => scoreGeoCandidate(b, location) - scoreGeoCandidate(a, location),
      );
      const best = sorted[0];
      if (
        best !== undefined &&
        typeof best.name === "string" &&
        typeof best.latitude === "number" &&
        typeof best.longitude === "number"
      ) {
        place = {
          name: best.name,
          region: typeof best.admin1 === "string" ? best.admin1 : null,
          country: typeof best.country === "string" ? best.country : null,
          latitude: best.latitude,
          longitude: best.longitude,
        };
      }
    }
  } catch (error) {
    console.error("[weather] geocoding failed for", location, error);
  }
  // Cache misses (not-found AND upstream failure) briefly — a bad place name
  // shouldn't turn every readiness check into a geocoding round trip.
  putCached(key, place, place === null ? FAILURE_TTL_MS : GEOCODE_TTL_MS);
  return place;
}

/* ── Forecast (real, within the horizon) ─────────────────────────────────── */

async function fetchForecast(place: GeoPlace, start: string, end: string): Promise<WeatherOutlook> {
  const key = `forecast:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${start}:${end}`;
  const cached = getCached<WeatherOutlook>(key);
  if (cached.fresh && cached.value !== null) return cached.value;

  let outlook: WeatherOutlook;
  try {
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
      timezone: "auto",
      start_date: start,
      end_date: end,
    });
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    const daily = data.daily as Partial<DailyForecastJson> | undefined;
    if (
      daily === undefined ||
      !Array.isArray(daily.time) ||
      daily.time.length === 0 ||
      !Array.isArray(daily.temperature_2m_max) ||
      !Array.isArray(daily.temperature_2m_min) ||
      !Array.isArray(daily.precipitation_sum)
    ) {
      throw new Error("malformed forecast payload");
    }
    outlook = buildForecastOutlook(place, {
      time: daily.time,
      weather_code: Array.isArray(daily.weather_code) ? daily.weather_code : [],
      temperature_2m_max: daily.temperature_2m_max,
      temperature_2m_min: daily.temperature_2m_min,
      precipitation_sum: daily.precipitation_sum,
      precipitation_probability_max: Array.isArray(daily.precipitation_probability_max)
        ? daily.precipitation_probability_max
        : [],
    });
    putCached(key, outlook, FORECAST_TTL_MS);
  } catch (error) {
    console.error("[weather] forecast fetch failed", error);
    outlook = {
      dataSource: "unavailable",
      reason: "The forecast service is unreachable or rate-limited right now — try again in a moment.",
    };
    putCached(key, outlook, FAILURE_TTL_MS);
  }
  return outlook;
}

/* ── Historical average (beyond the horizon) ─────────────────────────────── */

/** The trip's calendar window in one past year, Feb 29 clamped for non-leap years. */
function archiveWindow(tripStart: string, tripEnd: string, year: number): { start: string; end: string } {
  const startMonthDay = tripStart.slice(5);
  const endMonthDay = tripEnd.slice(5);
  const clamp = (monthDay: string) => (monthDay === "02-29" && !isLeapYear(year) ? "02-28" : monthDay);
  let start = `${year}-${clamp(startMonthDay)}`;
  let end = `${year}-${clamp(endMonthDay)}`;
  if (end < start) {
    // Year-boundary trip (e.g. Dec 28 → Jan 2): the window continues into year+1.
    end = `${year + 1}-${clamp(endMonthDay)}`;
  }
  return { start, end };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

async function fetchArchiveWindow(place: GeoPlace, start: string, end: string): Promise<DailyArchiveJson | null> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    start_date: start,
    end_date: end,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
  });
  const data = await fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`);
  const daily = data.daily as Partial<DailyArchiveJson> | undefined;
  if (
    daily === undefined ||
    !Array.isArray(daily.time) ||
    daily.time.length === 0 ||
    !Array.isArray(daily.temperature_2m_max) ||
    !Array.isArray(daily.temperature_2m_min) ||
    !Array.isArray(daily.precipitation_sum)
  ) {
    return null;
  }
  // A year whose window still has data gaps (ERA5 lags a few days) is not
  // usable for an honest average — skip it rather than average around holes.
  const hasHole =
    daily.temperature_2m_max.some((value) => value === null) ||
    daily.temperature_2m_min.some((value) => value === null) ||
    daily.precipitation_sum.some((value) => value === null);
  return hasHole ? null : (daily as DailyArchiveJson);
}

async function fetchHistoricalAverage(place: GeoPlace, tripStart: string, tripEnd: string): Promise<WeatherOutlook> {
  const key = `historical:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${tripStart}:${tripEnd}`;
  const cached = getCached<WeatherOutlook>(key);
  if (cached.fresh && cached.value !== null) return cached.value;

  let outlook: WeatherOutlook;
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: HISTORICAL_YEARS }, (_, index) => currentYear - 1 - index);
  try {
    const windows = await Promise.all(
      years.map(async (year) => {
        const window = archiveWindow(tripStart, tripEnd, year);
        try {
          return { year, daily: await fetchArchiveWindow(place, window.start, window.end) };
        } catch {
          return { year, daily: null }; // one odd year shouldn't sink the average
        }
      }),
    );
    const usable = windows.filter((entry) => entry.daily !== null) as { year: number; daily: DailyArchiveJson }[];
    if (usable.length === 0) {
      throw new Error("no usable archive years");
    }
    outlook = buildHistoricalOutlook(place, tripStart, tripEnd, usable);
    putCached(key, outlook, HISTORICAL_TTL_MS);
  } catch (error) {
    console.error("[weather] historical average failed", error);
    outlook = {
      dataSource: "unavailable",
      reason: "The historical weather service is unreachable right now — try again in a moment.",
    };
    putCached(key, outlook, FAILURE_TTL_MS);
  }
  return outlook;
}

/* ── The one entry point ─────────────────────────────────────────────────── */

/**
 * Build the outlook for a session's trip brief. Reads location and dates off
 * the brief, decides which of the three states applies, and returns a
 * WeatherOutlook — never throws.
 */
export async function buildWeatherOutlook(sessionId: string): Promise<WeatherOutlook> {
  try {
    const brief = await db.tripBrief.findUnique({ where: { sessionId } });
    const location = brief?.location ?? null;
    const startDate = brief?.startDate != null ? toDateOnly(brief.startDate) : null;
    const endDate = brief?.endDate != null ? toDateOnly(brief.endDate) : null;

    const incompleteReason = incompleteOutlookReason(location, startDate, endDate);
    if (incompleteReason !== null) {
      return { dataSource: "unavailable", reason: incompleteReason };
    }
    // The reason check guarantees all three are set from here on.
    const tripLocation = location as string;
    const tripStart = startDate as string;
    const tripEnd = endDate as string;

    const today = toDateOnly(new Date());
    const source = chooseWeatherSource(tripStart, tripEnd, today);
    if (source === "past") {
      return { dataSource: "unavailable", reason: "Those dates are already in the past — is the trip actually later?" };
    }

    const place = await geocode(tripLocation);
    if (place === null) {
      return {
        dataSource: "unavailable",
        reason: `I couldn't find “${tripLocation}” on the map — try naming it a little differently.`,
      };
    }

    if (source === "forecast") {
      // A trip already underway still has a real forecast ahead of it — clamp
      // the window's start to today and let the copy say what it covers.
      const start = tripStart < today ? today : tripStart;
      return fetchForecast(place, start, tripEnd);
    }

    return fetchHistoricalAverage(place, tripStart, tripEnd);
  } catch (error) {
    console.error("[weather] outlook build failed", error);
    return {
      dataSource: "unavailable",
      reason: "The weather service is unreachable right now — try again in a moment.",
    };
  }
}
