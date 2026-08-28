import { buildWeatherOutlook } from "@/lib/weather-open-meteo";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/weather?sessionId=<id>
 *
 * The weather outlook for the session's trip brief — real forecast, seasonal
 * average, or an honest "unavailable" with a reason. Read by the trip-brief
 * panel's weather chip, the get_weather_outlook WebMCP tool, and (indirectly)
 * check_trip_readiness. Read-only, so it works while the plan is locked too.
 *
 * Upstream calls are TTL-cached server-side (see weather-open-meteo.ts), so
 * the chip, the tool, and the readiness fold hitting the same trip window
 * cost one Open-Meteo round trip, not three.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    if (sessionId === null || sessionId.trim().length === 0) {
      return errorResponse(400, 'Query parameter "sessionId" is required.');
    }

    const outlook = await buildWeatherOutlook(sessionId);
    return Response.json({ outlook });
  } catch (error) {
    console.error("[api/weather]", error);
    // The shape is the contract: a broken upstream is an "unavailable"
    // outlook, never a 500 the tools would have to special-case.
    return Response.json({
      outlook: {
        dataSource: "unavailable",
        reason: "The weather service is unreachable right now — try again in a moment.",
      },
    });
  }
}
