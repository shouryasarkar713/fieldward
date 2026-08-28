import { db } from "@/lib/db";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/activity?sessionId=&limit=&sinceMinutes=&after=
 *
 * The session's activity log, newest first — the single source of truth both
 * the on-screen toast strip and the get_activity_log WebMCP tool read.
 *
 * - `limit` (1–100, default 20)
 * - `sinceMinutes` (≥ 1) — only events newer than N minutes
 * - `after` — ISO timestamp cursor; only events strictly newer (used by the
 *   toast strip's poll so it never replays old entries)
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      return errorResponse(400, 'Query parameter "sessionId" is required.');
    }

    const limitRaw = url.searchParams.get("limit");
    let limit = 20;
    if (limitRaw !== null) {
      limit = Number.parseInt(limitRaw, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return errorResponse(400, 'Query parameter "limit" must be an integer between 1 and 100.');
      }
    }

    const sinceRaw = url.searchParams.get("sinceMinutes");
    let since: Date | null = null;
    if (sinceRaw !== null) {
      const minutes = Number.parseInt(sinceRaw, 10);
      if (!Number.isInteger(minutes) || minutes < 1) {
        return errorResponse(400, 'Query parameter "sinceMinutes" must be an integer ≥ 1.');
      }
      since = new Date(Date.now() - minutes * 60_000);
    }

    const afterRaw = url.searchParams.get("after");
    let after: Date | null = null;
    if (afterRaw !== null) {
      after = new Date(afterRaw);
      if (Number.isNaN(after.getTime())) {
        return errorResponse(400, 'Query parameter "after" must be an ISO timestamp.');
      }
    }

    const events = await db.activityEvent.findMany({
      where: {
        sessionId,
        ...(since !== null ? { createdAt: { gt: since } } : {}),
        ...(after !== null ? { createdAt: { gt: after } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return Response.json({
      events: events.map((event) => ({
        id: event.id,
        actor: event.actor === "agent" ? "agent" : "human",
        action: event.action,
        detail: event.detail,
        at: event.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[api/activity GET]", error);
    return errorResponse(500, "Something went wrong reading the activity log.");
  }
}
