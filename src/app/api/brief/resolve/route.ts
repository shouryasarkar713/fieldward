import { loadBriefDTO } from "@/lib/brief-server";
import { db } from "@/lib/db";
import { clearProposal, getProposalPayload, parseBriefProposal } from "@/lib/proposals";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/brief/resolve
 * Body: { sessionId, decision: "accept" | "dismiss" }
 *
 * The HUMAN's verdict on a pending agent proposal (kind "brief"). Accept
 * merges the proposed fields into the live brief (and the human is the one
 * applying them — updatedBy stays "human"); dismiss drops the suggestion
 * untouched. Either way the proposal row is deleted. No agent path reaches
 * this route.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    const decision = body.decision;
    if (decision !== "accept" && decision !== "dismiss") {
      return errorResponse(400, 'Field "decision" must be "accept" or "dismiss".');
    }

    const brief = await db.tripBrief.findUnique({ where: { sessionId: sessionId.value } });
    if (brief === null) {
      return errorResponse(404, "No trip brief for this session yet.");
    }
    if (brief.lockedAt !== null) {
      return errorResponse(409, "This plan is locked — the brief is read-only.");
    }

    const proposal = parseBriefProposal(await getProposalPayload(sessionId.value, "brief"));
    if (proposal === null) {
      return errorResponse(404, "No pending proposal to resolve.");
    }

    await db.tripBrief.update({
      where: { sessionId: sessionId.value },
      data: {
        ...(decision === "accept"
          ? {
              ...(proposal.tripDescription !== undefined ? { tripDescription: proposal.tripDescription } : {}),
              ...(proposal.budget !== undefined ? { budget: proposal.budget } : {}),
              updatedBy: "human", // the human ratified these values
            }
          : {}),
      },
    });
    await clearProposal(sessionId.value, "brief");

    return Response.json({ brief: await loadBriefDTO(sessionId.value) });
  } catch (error) {
    console.error("[api/brief/resolve]", error);
    return errorResponse(500, "Something went wrong resolving that proposal.");
  }
}
