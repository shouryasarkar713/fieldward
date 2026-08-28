import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { errorResponse, optionalInt, optionalString, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/board/update
 * Body: { boardItemId, quantity?, label?, text? }
 *
 * Human-side card edits: a quantity stepper on gear cards, or inline edits
 * to a day block's label/text. (Agent notes are set at placement time by the
 * place_on_board tool; there is deliberately no note-editing tool.)
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const boardItemId = await requireString(body, "boardItemId");
    if (!boardItemId.ok) return errorResponse(400, boardItemId.error);

    const quantity = await optionalInt(body, "quantity", { min: 1, max: 20 });
    if (!quantity.ok) return errorResponse(400, quantity.error);
    const label = await optionalString(body, "label", { max: 120 });
    if (!label.ok) return errorResponse(400, label.error);
    const text = await optionalString(body, "text", { max: 280 });
    if (!text.ok) return errorResponse(400, text.error);

    if (quantity.value === undefined && label.value === undefined && text.value === undefined) {
      return errorResponse(400, 'Provide at least one of "quantity", "label", or "text".');
    }

    const existing = await db.boardItem.findUnique({ where: { id: boardItemId.value }, include: { gearItem: true } });
    if (existing === null) {
      return errorResponse(404, "Board item not found.");
    }

    const brief = await db.tripBrief.findUnique({ where: { sessionId: existing.sessionId } });
    if (brief?.lockedAt !== null && brief !== null) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    // Field-level sanity: quantity belongs to gear cards, label/text to days.
    if (quantity.value !== undefined && existing.itemType !== "gear") {
      return errorResponse(400, "Only gear cards have a quantity.");
    }
    if ((label.value !== undefined || text.value !== undefined) && existing.itemType !== "day") {
      return errorResponse(400, "Only day blocks have a label and text.");
    }

    const updated = await db.boardItem.update({
      where: { id: boardItemId.value },
      data: {
        ...(quantity.value !== undefined ? { quantity: quantity.value } : {}),
        ...(label.value !== undefined ? { label: label.value } : {}),
        ...(text.value !== undefined ? { text: text.value } : {}),
      },
      include: { gearItem: true },
    });

    return Response.json({ item: toBoardItemDTO(updated) });
  } catch (error) {
    console.error("[api/board/update]", error);
    return errorResponse(500, "Something went wrong updating that card.");
  }
}
