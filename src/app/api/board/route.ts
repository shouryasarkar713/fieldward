import { db } from "@/lib/db";
import { toBoardSummary } from "@/lib/gear";
import { loadBoardItems, isBoardLocked } from "@/lib/board-server";
import { getProposalPayload, parseDayBlockProposal, parseDayOrderProposal } from "@/lib/proposals";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/board?sessionId=<id>
 *
 * The whole board for a session: every item with position, note, attribution,
 * gear totals, the locked flag, and any pending day-order or day-block suggestions.
 * This is the single read that powers the UI's poll loop AND the get_board_state
 * WebMCP tool — one board, one truth, two readers.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    if (sessionId === null || sessionId.trim().length === 0) {
      return errorResponse(400, 'Query parameter "sessionId" is required.');
    }

    const [items, locked, dayOrderPayload, dayBlockPayload] = await Promise.all([
      loadBoardItems(sessionId),
      isBoardLocked(sessionId),
      getProposalPayload(sessionId, "day-order"),
      getProposalPayload(sessionId, "day-block"),
    ]);
    const summary = toBoardSummary(
      items,
      locked,
      parseDayOrderProposal(dayOrderPayload),
      parseDayBlockProposal(dayBlockPayload),
    );

    return Response.json({ sessionId, ...summary });
  } catch (error) {
    console.error("[api/board]", error);
    return errorResponse(500, "Something went wrong loading the board.");
  }
}
