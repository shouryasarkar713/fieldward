import { db } from "@/lib/db";
import { isAddedBy } from "@/lib/types";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/activity/log
 * Body: { sessionId, actor, action, detail }
 *
 * Writes one row to the shared activity log. Called by the board UI for human
 * actions (viewed gear, placed or moved cards, edited the brief) and by the
 * WebMCP tool layer for agent tool calls — one table, two authors.
 *
 * No auth (like the rest of this demo); `actor` is asserted by the caller,
 * and the tool layer hardcodes "agent" the same way place_on_board hardcodes
 * its attribution.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);
    const action = requireString(body, "action", { max: 64 });
    if (!action.ok) return errorResponse(400, action.error);
    const detail = requireString(body, "detail", { max: 200 });
    if (!detail.ok) return errorResponse(400, detail.error);

    const actor = body.actor;
    if (!isAddedBy(actor)) {
      return errorResponse(400, 'Field "actor" must be either "human" or "agent".');
    }

    const event = await db.activityEvent.create({
      data: { sessionId: sessionId.value, actor, action: action.value, detail: detail.value },
    });

    return Response.json(
      {
        event: {
          id: event.id,
          actor: event.actor === "agent" ? "agent" : "human",
          action: event.action,
          detail: event.detail,
          at: event.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/activity/log]", error);
    return errorResponse(500, "Something went wrong writing to the activity log.");
  }
}
