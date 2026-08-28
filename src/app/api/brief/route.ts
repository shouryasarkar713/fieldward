import { loadBriefDTO } from "@/lib/brief-server";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/brief?sessionId=<id>
 *
 * The shared trip brief — what the trip is, where and when it runs, the
 * budget, any pending agent proposal, and the locked state. Read by the
 * human UI panel and the get_trip_brief WebMCP tool.
 *
 * Returns { brief: null } when nothing has been set yet (the UI and the
 * tool both treat that as "ask the human about the trip").
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    if (sessionId === null || sessionId.trim().length === 0) {
      return errorResponse(400, 'Query parameter "sessionId" is required.');
    }

    return Response.json({ brief: await loadBriefDTO(sessionId) });
  } catch (error) {
    console.error("[api/brief]", error);
    return errorResponse(500, "Something went wrong loading the trip brief.");
  }
}
