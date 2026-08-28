import { loadBriefDTO } from "@/lib/brief-server";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/dates";
import { isAddedBy } from "@/lib/types";
import {
  errorResponse,
  optionalDateOnly,
  optionalInt,
  readJsonBody,
  requireString,
  sentString,
} from "@/lib/validate";

/**
 * POST /api/brief/update
 * Body: { sessionId, tripDescription, budget, location, startDate, endDate,
 *         updatedBy: "human" }
 *
 * The HUMAN's direct edit path from the brief panel. Accepts updatedBy
 * "human" only — agent changes must go through /api/brief/propose, where
 * they land as a pending suggestion the human resolves. Refusing "agent"
 * here is the enforcement point for that boundary.
 *
 * The editor sends the whole object, so every field carries clear-semantics:
 * an empty tripDescription clears it, an empty location clears it, absent or
 * empty dates clear them, budget null clears it. Dates are date-only strings
 * ("YYYY-MM-DD") stored as noon-UTC so timezone math can never flip the day.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    const updatedBy = body.updatedBy;
    if (!isAddedBy(updatedBy) || updatedBy !== "human") {
      return errorResponse(403, "Only the human edits the brief directly — agents propose.");
    }

    const tripDescription = await sentString(body, "tripDescription", { max: 500 });
    if (!tripDescription.ok) return errorResponse(400, tripDescription.error);
    if (tripDescription.value === undefined) {
      return errorResponse(400, 'Field "tripDescription" is required (empty string clears it).');
    }
    const budget = await optionalInt(body, "budget", { min: 0, max: 100_000_000 });
    if (!budget.ok) return errorResponse(400, budget.error);
    const location = await sentString(body, "location", { max: 160 });
    if (!location.ok) return errorResponse(400, location.error);
    const startDate = await optionalDateOnly(body, "startDate");
    if (!startDate.ok) return errorResponse(400, startDate.error);
    const endDate = await optionalDateOnly(body, "endDate");
    if (!endDate.ok) return errorResponse(400, endDate.error);

    if (startDate.value !== undefined && endDate.value !== undefined && startDate.value > endDate.value) {
      return errorResponse(400, "The trip's end date is before its start date.");
    }

    const existing = await db.tripBrief.findUnique({ where: { sessionId: sessionId.value } });
    if (existing !== null && existing.lockedAt !== null) {
      return errorResponse(409, "This plan is locked — the brief is read-only.");
    }

    await db.tripBrief.upsert({
      where: { sessionId: sessionId.value },
      create: {
        sessionId: sessionId.value,
        tripDescription: tripDescription.value,
        budget: budget.value ?? null,
        location: location.value?.length ? location.value : null,
        startDate: startDate.value !== undefined ? parseDateOnly(startDate.value) : null,
        endDate: endDate.value !== undefined ? parseDateOnly(endDate.value) : null,
        updatedBy: "human",
      },
      update: {
        tripDescription: tripDescription.value,
        budget: budget.value ?? null,
        location: location.value?.length ? location.value : null,
        startDate: startDate.value !== undefined ? parseDateOnly(startDate.value) : null,
        endDate: endDate.value !== undefined ? parseDateOnly(endDate.value) : null,
        updatedBy: "human",
      },
    });

    return Response.json({ brief: await loadBriefDTO(sessionId.value) });
  } catch (error) {
    console.error("[api/brief/update]", error);
    return errorResponse(500, "Something went wrong saving the trip brief.");
  }
}
