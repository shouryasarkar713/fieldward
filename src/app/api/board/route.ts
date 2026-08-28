import { db } from "@/lib/db";
import { toBoardSummary } from "@/lib/gear";
import { loadBoardItems, isBoardLocked } from "@/lib/board-server";
import { getProposalPayload, parseDayOrderProposal } from "@/lib/proposals";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/board?sessionId=<id>
 *
 * The whole board for a session: every item with position, note, attribution,
 * gear totals, the locked flag, and any pending day-order suggestion. This is
 * the single read that powers the UI's poll loop AND the get_board_state
 * WebMCP tool — one board, one truth, two readers. The pending day-order
 * rides along so the workspace's proposal banner appears the moment the
 * agent suggests (the poll or the fieldward:board-changed nudge picks it up).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    if (sessionId === null || sessionId.trim().length === 0) {
      return errorResponse(400, 'Query parameter "sessionId" is required.');
    }

    const [items, locked, dayOrderPayload] = await Promise.all([
      loadBoardItems(sessionId),
      isBoardLocked(sessionId),
      getProposalPayload(sessionId, "day-order"),
    ]);
    const summary = toBoardSummary(items, locked, parseDayOrderProposal(dayOrderPayload));

    return Response.json({ sessionId, ...summary });
  } catch (error) {
    console.error("[api/board]", error);
    return errorResponse(500, "Something went wrong loading the board.");
  }
}
