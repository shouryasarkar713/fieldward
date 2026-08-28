import { loadBriefDTO } from "@/lib/brief-server";
import { db } from "@/lib/db";
import { putProposal, serializeBriefProposal } from "@/lib/proposals";
import type { TripBriefProposal } from "@/lib/types";
import { errorResponse, optionalNumber, optionalString, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/brief/propose
 * Body: { sessionId, tripDescription?, budget? }  — budget in DOLLARS here
 * (agent-facing unit); 0 clears it.
 *
 * The AGENT's path (called by the propose_trip_brief_update WebMCP tool).
 * Nothing is applied: the fields are stored as a pending suggestion in the
 * generalized Proposal table (kind "brief") that the human must Accept or
 * Dismiss in the UI. Replaces any earlier pending brief proposal — one
 * suggestion on the table at a time.
 *
 * There is deliberately no updatedBy field on this route: only this route
 * writes brief proposals, and only /api/brief/resolve applies them.
 * Location and trip dates are NOT proposal material — they're the human's
 * factual inputs about their real trip, and the agent can't know them
 * better than the human does.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    const tripDescription = await optionalString(body, "tripDescription", { max: 500 });
    if (!tripDescription.ok) return errorResponse(400, tripDescription.error);
    const budget = await optionalNumber(body, "budget", { min: 0, max: 1_000_000 });
    if (!budget.ok) return errorResponse(400, budget.error);

    if (tripDescription.value === undefined && budget.value === undefined) {
      return errorResponse(400, "Provide at least one of tripDescription or budget.");
    }

    const existing = await db.tripBrief.findUnique({ where: { sessionId: sessionId.value } });
    if (existing !== null && existing.lockedAt !== null) {
      return errorResponse(409, "This plan is locked — the brief is read-only.");
    }

    const proposal: TripBriefProposal = { budget: null };
    if (tripDescription.value !== undefined) {
      proposal.tripDescription = tripDescription.value;
    }
    if (budget.value !== undefined) {
      // 0 is the documented "clear the budget" sentinel.
      proposal.budget = budget.value === 0 ? null : Math.round(budget.value * 100);
    }

    // Ensure the brief row exists (create-if-missing, no field changes) so a
    // proposal on a fresh session can be resolved without a save first —
    // same behavior the old proposalJson upsert provided.
    await db.tripBrief.upsert({
      where: { sessionId: sessionId.value },
      create: { sessionId: sessionId.value },
      update: {},
    });

    await putProposal(sessionId.value, "brief", serializeBriefProposal(proposal));

    return Response.json({ brief: await loadBriefDTO(sessionId.value) });
  } catch (error) {
    console.error("[api/brief/propose]", error);
    return errorResponse(500, "Something went wrong proposing that brief update.");
  }
}
