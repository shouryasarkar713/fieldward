import { db } from "@/lib/db";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/brief/reset
 * Body: { sessionId }
 *
 * Human-only "Start a new plan" (reached from the locked export view): wipes
 * this session's board, brief, proposals, and activity log so the same
 * browser can run the demo again. Like lock, no WebMCP tool reaches this
 * route — an agent must never be able to erase the human's work.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    await db.$transaction([
      db.boardItem.deleteMany({ where: { sessionId: sessionId.value } }),
      db.tripBrief.deleteMany({ where: { sessionId: sessionId.value } }),
      db.proposal.deleteMany({ where: { sessionId: sessionId.value } }),
      db.activityEvent.deleteMany({ where: { sessionId: sessionId.value } }),
    ]);

    return Response.json({ brief: null });
  } catch (error) {
    console.error("[api/brief/reset]", error);
    return errorResponse(500, "Something went wrong starting a new plan.");
  }
}
