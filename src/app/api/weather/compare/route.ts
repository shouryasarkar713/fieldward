import { db } from "@/lib/db";
import { parseTags } from "@/lib/gear";
import { computeTripReadiness } from "@/lib/trip-readiness";
import { mergeReadinessWithWeather } from "@/lib/weather";
import { compareWeatherOutlooks } from "@/lib/weather-open-meteo";
import { errorResponse, optionalString, readJsonBody } from "@/lib/validate";
import type { DateRangeComparison } from "@/lib/types";

/**
 * POST /api/weather/compare
 * Body: { sessionId?, location?, dateRanges: Array<{ startDate: string, endDate: string, label?: string }> }
 *
 * Evaluates 2–3 date ranges side-by-side:
 * - Pulls location and trip description from the session's brief (or request body)
 * - Fetches real Open-Meteo weather outlooks concurrently
 * - Computes archetype + weather-grounded readiness gaps for each range
 * - Returns independent dataSource labels per date range without committing changes to the brief
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionIdResult = await optionalString(body, "sessionId", { max: 100 });
    if (!sessionIdResult.ok) return errorResponse(400, sessionIdResult.error);
    const sessionId = sessionIdResult.value;

    const rawRanges = body.dateRanges;
    if (!Array.isArray(rawRanges) || rawRanges.length < 2 || rawRanges.length > 3) {
      return errorResponse(400, 'Field "dateRanges" must be an array with 2 or 3 date ranges.');
    }

    const dateRanges: Array<{ startDate: string; endDate: string; label?: string }> = [];
    for (let i = 0; i < rawRanges.length; i++) {
      const entry = rawRanges[i];
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.startDate !== "string" ||
        typeof entry.endDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.endDate)
      ) {
        return errorResponse(400, `dateRanges[${i}] must have valid startDate and endDate strings in YYYY-MM-DD format.`);
      }
      dateRanges.push({
        startDate: entry.startDate,
        endDate: entry.endDate,
        label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : undefined,
      });
    }

    let location = typeof body.location === "string" ? body.location.trim() : null;
    let tripDescription = "";
    let boardLines: Array<{ category: string | null; tags: string[] }> = [];

    if (sessionId) {
      const [brief, boardItems] = await Promise.all([
        db.tripBrief.findUnique({ where: { sessionId } }),
        db.boardItem.findMany({ where: { sessionId }, include: { gearItem: true } }),
      ]);

      if (brief) {
        if (!location && brief.location) {
          location = brief.location;
        }
        tripDescription = brief.tripDescription || "";
      }

      boardLines = boardItems
        .filter((item) => item.itemType === "gear" && item.gearItem !== null)
        .map((item) => ({
          category: item.gearItem!.category,
          tags: parseTags(item.gearItem!.tags),
        }));
    }

    if (!location) {
      return errorResponse(400, "Trip location is required to compare date ranges. Set the location in the brief or request.");
    }

    // 1. Run concurrent weather lookups
    const weatherResults = await compareWeatherOutlooks(location, dateRanges);

    // 2. Compute readiness per date range
    const comparisons: DateRangeComparison[] = weatherResults.map(({ range, outlook }) => {
      const baseReadiness = computeTripReadiness(boardLines, tripDescription);
      const readinessWithWeather = mergeReadinessWithWeather(baseReadiness, outlook, boardLines);

      return {
        label: range.label,
        startDate: range.startDate,
        endDate: range.endDate,
        weather: outlook,
        readiness: readinessWithWeather,
      };
    });

    return Response.json({
      location,
      comparisons,
    });
  } catch (error) {
    console.error("[api/weather/compare]", error);
    return errorResponse(500, "Something went wrong comparing trip dates.");
  }
}
