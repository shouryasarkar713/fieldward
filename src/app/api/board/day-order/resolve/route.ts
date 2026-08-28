import { db } from "@/lib/db";
import { toBoardSummary } from "@/lib/gear";
import { isBoardLocked, loadBoardItems } from "@/lib/board-server";
import { isCompletePermutation, planDayOrderReassignment } from "@/lib/day-order";
import { clearProposal, getProposalPayload, parseDayOrderProposal } from "@/lib/proposals";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/board/day-order/resolve
 * Body: { sessionId, decision: "accept" | "dismiss" }
 *
 * The HUMAN's verdict on a pending day-order proposal (kind "day-order") —
 * the same mechanism as /api/brief/resolve, applied to the board. Dismiss
 * discards the suggestion with no change. Accept applies it by slot
 * reassignment: the day blocks' existing positions, sorted into spatial
 * reading order, become slots, and the proposed sequence decides which block
 * lands in which slot (see src/lib/day-order.ts). The layout shape is
 * preserved; the reading order becomes the proposal. No agent path reaches
 * this route.
 *
 * Either way the proposal row is deleted. If the day blocks changed between
 * proposal and accept (added, removed), the stale suggestion is discarded
 * with a 409 — the agent should suggest again against the new board.
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

    if (await isBoardLocked(sessionId.value)) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const proposal = parseDayOrderProposal(await getProposalPayload(sessionId.value, "day-order"));
    if (proposal === null) {
      return errorResponse(404, "No pending day-order proposal to resolve.");
    }

    if (decision === "dismiss") {
      await clearProposal(sessionId.value, "day-order");
      return boardResponse(sessionId.value, 0);
    }

    const dayBlocks = await db.boardItem.findMany({
      where: { sessionId: sessionId.value, itemType: "day" },
    });
    const dayIds = dayBlocks.map((block) => block.id);
    if (!isCompletePermutation(proposal.orderedBoardItemIds, dayIds)) {
      // The human edited their day blocks after the suggestion — it's stale.
      await clearProposal(sessionId.value, "day-order");
      return errorResponse(409, "The day blocks changed since that suggestion — ask your agent to suggest again.");
    }

    const updates = planDayOrderReassignment(dayBlocks, proposal.orderedBoardItemIds);
    if (updates.length > 0) {
      await db.$transaction(
        updates.map((update) =>
          db.boardItem.update({
            where: { id: update.id },
            data: { x: update.x, y: update.y },
          }),
        ),
      );
    }
    await clearProposal(sessionId.value, "day-order");

    return boardResponse(sessionId.value, updates.length);
  } catch (error) {
    console.error("[api/board/day-order/resolve]", error);
    return errorResponse(500, "Something went wrong resolving that day order.");
  }
}

async function boardResponse(sessionId: string, movedCount: number): Promise<Response> {
  const [items, locked] = await Promise.all([loadBoardItems(sessionId), isBoardLocked(sessionId)]);
  return Response.json({ movedCount, ...toBoardSummary(items, locked, null) });
}
