/**
 * Trip weather logic — pure functions, shared by three consumers:
 *
 *   - the get_weather_outlook WebMCP tool (what the agent sees),
 *   - the check_trip_readiness fold (weather-driven gaps in one coherent
 *     readiness result),
 *   - the trip-brief panel's weather chip (what the human sees).
 *
 * The one rule that shapes everything: honesty about data quality. An
 * outlook is always in exactly one of three states —
 *
 *   "forecast"           real daily forecast, trip within the ~16-day horizon
 *   "historical-average" same calendar window averaged over past years
 *   "unavailable"        plus a human-readable reason
 *
 * — and neither the tool output, the readiness copy, nor the chip ever
 * blurs "real forecast" with "rough seasonal guess".
 *
 * Upstream fetching (Open-Meteo) lives in weather-open-meteo.ts; everything
 * here is deterministic and testable with fixtures.
 */

import { daysBetween, monthYearLabel } from "@/lib/dates";
import type { BoardLineLike, TripReadinessResult } from "@/lib/trip-readiness";
import type { WeatherDay, WeatherOutlook } from "@/lib/types";

/** Open-Meteo's forecast reaches about 16 days out (today + 15). */
export const FORECAST_HORIZON_DAYS = 15;

/** Rain thresholds — looser for a real forecast than for a seasonal average. */
const FORECAST_RAIN_MM = 1.0;
const FORECAST_RAIN_CHANCE_PCT = 50;
const HISTORICAL_RAIN_MM = 2.5;
/** A freezing night is the signal that winter-rated gear stops being optional. */
const FREEZING_C = 0;

export type GeoPlace = {
  name: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

export type DailyForecastJson = {
  time: string[];
  weather_code: (number | null)[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
  precipitation_probability_max: (number | null)[];
};

export type DailyArchiveJson = {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
};

/* ── Which of the three states are we in? ────────────────────────────────── */

export type WeatherSourceChoice = "forecast" | "historical-average" | "past" | "incomplete";

/**
 * Pure classification of the trip's date window (date-only "YYYY-MM-DD"):
 *
 *   past       the whole trip is behind us — nothing to plan against
 *   forecast   the trip ends within the forecast horizon (start clamped to
 *              today by the caller when the trip is already underway)
 *   historical the trip runs past the horizon — seasonal average instead
 *   incomplete place or dates missing (or dates swapped) — the caller writes
 *              the reason copy
 */
export function chooseWeatherSource(
  startDate: string | null,
  endDate: string | null,
  today: string,
): WeatherSourceChoice {
  if (startDate === null || endDate === null) return "incomplete";
  if (endDate < today) return "past";
  if (daysBetween(today, endDate) <= FORECAST_HORIZON_DAYS) return "forecast";
  return "historical-average";
}

/** The human-readable reason an outlook is unavailable before any upstream call. */
export function incompleteOutlookReason(
  location: string | null,
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (location === null || location.trim().length === 0) {
    return "Set the trip's place in the brief — then I can pull a real outlook.";
  }
  if (startDate === null || endDate === null) {
    return "Set the trip's dates in the brief — then I can pull a real outlook.";
  }
  if (startDate > endDate) {
    return "The trip's end date is before its start date — fix the dates and try again.";
  }
  return null;
}

/* ── WMO weather interpretation codes (Open-Meteo's daily weather_code) ──── */

export function weatherCodeLabel(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const labels: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Slight rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Slight snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Violent rain showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with hail",
  };
  return labels[code] ?? null;
}

/* ── Outlook builders (from upstream JSON) ───────────────────────────────── */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildForecastOutlook(
  geo: GeoPlace,
  daily: DailyForecastJson,
): Extract<WeatherOutlook, { dataSource: "forecast" }> {
  const days: WeatherDay[] = daily.time.map((date, index) => ({
    date,
    tempMaxC: round1(daily.temperature_2m_max[index] ?? 0),
    tempMinC: round1(daily.temperature_2m_min[index] ?? 0),
    precipSumMm: round1(daily.precipitation_sum[index] ?? 0),
    precipChancePct:
      daily.precipitation_probability_max[index] === null || daily.precipitation_probability_max[index] === undefined
        ? null
        : Math.round(daily.precipitation_probability_max[index]),
    condition: weatherCodeLabel(daily.weather_code[index]),
  }));
  return {
    dataSource: "forecast",
    location: { name: geo.name, region: geo.region, country: geo.country },
    dateRange: { start: daily.time[0], end: daily.time[daily.time.length - 1] },
    days,
    summary: summarizeForecast(days),
  };
}

/**
 * Average the same calendar window across past years. Windows can differ in
 * length by a day (Feb 29 clamping), so the average runs to the SHORTEST
 * window — trip day i is averaged across years at index i.
 */
export function buildHistoricalOutlook(
  geo: GeoPlace,
  tripStart: string,
  tripEnd: string,
  years: { year: number; daily: DailyArchiveJson }[],
): Extract<WeatherOutlook, { dataSource: "historical-average" }> {
  const usable = years.filter((entry) => entry.daily.time.length > 0);
  const length = Math.min(...usable.map((entry) => entry.daily.time.length));
  const days: WeatherDay[] = [];
  for (let index = 0; index < length; index++) {
    const tempsMax = usable.map((entry) => entry.daily.temperature_2m_max[index]).filter((v): v is number => v !== null && v !== undefined);
    const tempsMin = usable.map((entry) => entry.daily.temperature_2m_min[index]).filter((v): v is number => v !== null && v !== undefined);
    const precips = usable.map((entry) => entry.daily.precipitation_sum[index]).filter((v): v is number => v !== null && v !== undefined);
    const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
    days.push({
      // Dates from the trip's own window — the average describes the trip days.
      date: addIsoDays(tripStart, index),
      tempMaxC: round1(mean(tempsMax)),
      tempMinC: round1(mean(tempsMin)),
      precipSumMm: round1(mean(precips)),
      precipChancePct: null,
      condition: null,
    });
  }
  return {
    dataSource: "historical-average",
    location: { name: geo.name, region: geo.region, country: geo.country },
    dateRange: { start: tripStart, end: tripEnd },
    days,
    summary: summarizeHistorical(days, tripStart),
    sampledYears: usable.length,
  };
}

/* ── Summaries ───────────────────────────────────────────────────────────── */

export function isRainyForecastDay(day: WeatherDay): boolean {
  if (day.precipChancePct !== null && day.precipChancePct >= FORECAST_RAIN_CHANCE_PCT) return true;
  return day.precipSumMm >= FORECAST_RAIN_MM;
}

export function isRainyHistoricalDay(day: WeatherDay): boolean {
  return day.precipSumMm >= HISTORICAL_RAIN_MM;
}

function tempPhrase(days: WeatherDay[]): string {
  const high = Math.max(...days.map((day) => day.tempMaxC));
  const low = Math.min(...days.map((day) => day.tempMinC));
  return `highs near ${Math.round(high)}°C, lows near ${Math.round(low)}°C`;
}

export function summarizeForecast(days: WeatherDay[]): string {
  if (days.length === 0) return "No daily forecast available for those dates.";
  const rainy = days.filter(isRainyForecastDay).length;
  const rainPhrase =
    rainy === 0 ? "Mostly dry" : `Rain likely on ${rainy} of ${days.length} day${days.length === 1 ? "" : "s"}`;
  return `${rainPhrase}; ${tempPhrase(days)}.`;
}

export function summarizeHistorical(days: WeatherDay[], tripStart: string): string {
  if (days.length === 0) return "No historical data available for those dates.";
  const rainy = days.filter(isRainyHistoricalDay).length;
  const season = monthYearLabel(tripStart).split(" ")[0];
  const rainPhrase =
    rainy === 0
      ? `Usually mostly dry in ${season}`
      : `Rain is common here in ${season} — about ${rainy} of ${days.length} day${days.length === 1 ? "" : "s"} typically see it`;
  return `${rainPhrase}; ${tempPhrase(days)} (seasonal average).`;
}

/* ── Weather-driven gear gaps ────────────────────────────────────────────── */

/**
 * The two weather signals that map to gear the library actually carries
 * (grounded in real seed tags, same rule as the archetype requirements):
 *
 *   rain  → something tagged "waterproof"
 *   cold  → something tagged "winter-rated" (freezing nights)
 *
 * Wind and heat have no grounded gear answer in this library, so they get no
 * gap lines — a checklist that can't be filled is noise.
 */
export function weatherGapLines(
  outlook: WeatherOutlook,
  lines: BoardLineLike[],
): { gaps: string[]; covered: string[] } {
  const gaps: string[] = [];
  const covered: string[] = [];

  const hasWaterproof = lines.some((line) => line.tags.includes("waterproof"));
  const hasWinterRated = lines.some((line) => line.tags.includes("winter-rated"));

  if (outlook.dataSource === "forecast") {
    const firstRain = outlook.days.findIndex(isRainyForecastDay);
    if (firstRain >= 0) {
      if (hasWaterproof) {
        covered.push("waterproof gear for the rain risk");
      } else {
        gaps.push(`rain likely on day ${firstRain + 1} — no board item tagged waterproof yet`);
      }
    }
    const coldest = outlook.days.reduce(
      (best, day, index) => (day.tempMinC < outlook.days[best].tempMinC ? index : best),
      0,
    );
    if (outlook.days[coldest]?.tempMinC <= FREEZING_C) {
      if (hasWinterRated) {
        covered.push("winter-rated gear for the cold nights");
      } else {
        gaps.push(
          `lows near ${Math.round(outlook.days[coldest].tempMinC)}°C on day ${coldest + 1} — no board item tagged winter-rated yet`,
        );
      }
    }
    return { gaps, covered };
  }

  if (outlook.dataSource === "historical-average") {
    const rainyDays = outlook.days.filter(isRainyHistoricalDay).length;
    const season = monthYearLabel(outlook.dateRange.start).split(" ")[0];
    if (rainyDays > 0) {
      if (hasWaterproof) {
        covered.push("waterproof gear for the typical rain");
      } else {
        gaps.push(`rain is common here in ${season} — no board item tagged waterproof yet`);
      }
    }
    const coldestLow = Math.min(...outlook.days.map((day) => day.tempMinC));
    if (coldestLow <= FREEZING_C) {
      if (hasWinterRated) {
        covered.push("winter-rated gear for the typically freezing nights");
      } else {
        gaps.push(`freezing nights are typical here in ${season} — no board item tagged winter-rated yet`);
      }
    }
    return { gaps, covered };
  }

  return { gaps, covered };
}

/* ── The readiness fold: one coherent result ─────────────────────────────── */

export type WeatherGrounding = {
  dataSource: WeatherOutlook["dataSource"];
  /** Present for forecast/historical-average. */
  summary?: string;
  /** Present when unavailable. */
  reason?: string;
};

export type TripReadinessWithWeather = TripReadinessResult & {
  /** How the weather half of this result is grounded (always present). */
  weather: WeatherGrounding;
};

/**
 * Fold weather-driven gaps into a trip-readiness result — the ONE result both
 * the agent's check_trip_readiness tool and the human's readiness panel show.
 * Weather gaps append after the archetype gaps (each line independently true
 * and actionable; word overlap between the two systems isn't deduplicated
 * because "no waterproof footwear" and "rain likely, nothing waterproof at
 * all" answer different questions).
 */
export function mergeReadinessWithWeather(
  result: TripReadinessResult,
  outlook: WeatherOutlook,
  lines: BoardLineLike[],
): TripReadinessWithWeather {
  const { gaps, covered } = weatherGapLines(outlook, lines);
  const weather: WeatherGrounding =
    outlook.dataSource === "unavailable"
      ? { dataSource: "unavailable", reason: outlook.reason }
      : { dataSource: outlook.dataSource, summary: outlook.summary };
  return {
    ...result,
    gaps: [...result.gaps, ...gaps],
    covered: [...result.covered, ...covered],
    weather,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function addIsoDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}
