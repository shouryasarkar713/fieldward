import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { isBoardLocked } from "@/lib/board-server";
import { spatialDayOrder } from "@/lib/day-order";
import { putProposal, serializeDayOrderProposal } from "@/lib/proposals";
import { errorResponse, optionalString, readJsonBody, requireString, requireStringArray } from "@/lib/validate";

/**
 * POST /api/board/day-order/propose
 * Body: { sessionId, orderedBoardItemIds: string[], note? }
 *
 * The AGENT's path (called by the suggest_day_order WebMCP tool). Nothing is
 * reordered: the sequence is stored as a pending proposal (kind "day-order")
 * the human must Accept or Dismiss in the board UI. Replaces any earlier
 * pending day-order proposal — one suggestion on the table at a time.
 *
 * Validation is strict on purpose: the array must be a COMPLETE ordering of
 * the session's day blocks — every id a real day block of this session, no
 * duplicates, nothing left out. The agent is proposing a new sequence for
 * days the human already authored; it can never use this route to create,
 * delete, or edit day blocks (that boundary stays 403 in /api/board/place).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    if (await isBoardLocked(sessionId.value)) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const orderedIds = await requireStringArray(body, "orderedBoardItemIds", { minItems: 2, maxItems: 20 });
    if (!orderedIds.ok) return errorResponse(400, orderedIds.error);
    const note = await optionalString(body, "note", { max: 280 });
    if (!note.ok) return errorResponse(400, note.error);

    const dayBlocks = await db.boardItem.findMany({
      where: { sessionId: sessionId.value, itemType: "day" },
      include: { gearItem: true },
      orderBy: { createdAt: "asc" },
    });
    if (dayBlocks.length < 2) {
      return errorResponse(400, "There aren't two day blocks to order yet — the human authors those.");
    }

    const dayIds = dayBlocks.map((block) => block.id);
    const unknown = orderedIds.value.filter((id) => !dayIds.includes(id));
    if (unknown.length > 0) {
      return errorResponse(
        404,
        "Every id must be a day block on this board — gear card ids and unknown ids are rejected.",
      );
    }
    const unique = new Set(orderedIds.value);
    if (unique.size !== orderedIds.value.length) {
      return errorResponse(400, 'Field "orderedBoardItemIds" contains the same day block twice.');
    }
    if (unique.size !== dayIds.length) {
      return errorResponse(
        400,
        `The proposal must cover every day block — this board has ${dayIds.length} and you sent ${unique.size}.`,
      );
    }

    await putProposal(
      sessionId.value,
      "day-order",
      serializeDayOrderProposal({ orderedBoardItemIds: orderedIds.value, note: note.value ?? null }),
    );

    return Response.json({
      proposal: { orderedBoardItemIds: orderedIds.value, note: note.value ?? null },
      currentOrder: spatialDayOrder(dayBlocks).map((block) => toBoardItemDTO(block)),
    });
  } catch (error) {
    console.error("[api/board/day-order/propose]", error);
    return errorResponse(500, "Something went wrong suggesting that day order.");
  }
}
