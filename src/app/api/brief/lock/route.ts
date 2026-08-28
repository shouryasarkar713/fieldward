import { loadBriefDTO } from "@/lib/brief-server";
import { db } from "@/lib/db";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/brief/lock
 * Body: { sessionId }
 *
 * THE trust boundary of this app, applied to planning instead of payment:
 * locking the plan is the one irreversible action, and it belongs to a real
 * human click. No WebMCP tool calls this route — there is no lock tool in
 * src/lib/mcp-tools.ts, and verify-mcp asserts it stays that way.
 *
 * While locked, every board and brief mutation route returns 409, so even a
 * rogue tool can only read.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    const existing = await db.tripBrief.findUnique({ where: { sessionId: sessionId.value } });
    if (existing === null) {
      return errorResponse(404, "Nothing to lock — set a trip brief first.");
    }
    if (existing.lockedAt !== null) {
      return errorResponse(409, "This plan is already locked.");
    }

    await db.tripBrief.update({
      where: { sessionId: sessionId.value },
      data: { lockedAt: new Date(), updatedBy: "human" },
    });

    return Response.json({ brief: await loadBriefDTO(sessionId.value) });
  } catch (error) {
    console.error("[api/brief/lock]", error);
    return errorResponse(500, "Something went wrong locking the plan.");
  }
}
