import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { clampPosition, getOwnershipFromY } from "@/lib/board-geometry";
import { errorResponse, optionalNumber, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/board/move
 * Body: { boardItemId, x, y }
 *
 * The write path for card positions — used by human drags and by the
 * move_board_item WebMCP tool (that's the point: an agent rearranging the
 * board moves the exact same cards the human sees). Positions are clamped to
 * the board bounds so nothing can be flung into the void.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const boardItemId = await requireString(body, "boardItemId");
    if (!boardItemId.ok) return errorResponse(400, boardItemId.error);

    const x = await optionalNumber(body, "x", { min: 0, max: 1_000_000 });
    if (!x.ok || x.value === undefined) {
      return errorResponse(400, 'Field "x" must be a number.');
    }
    const y = await optionalNumber(body, "y", { min: 0, max: 1_000_000 });
    if (!y.ok || y.value === undefined) {
      return errorResponse(400, 'Field "y" must be a number.');
    }

    const existing = await db.boardItem.findUnique({ where: { id: boardItemId.value }, include: { gearItem: true } });
    if (existing === null) {
      return errorResponse(404, "Board item not found.");
    }

    const brief = await db.tripBrief.findUnique({ where: { sessionId: existing.sessionId } });
    if (brief?.lockedAt !== null && brief !== null) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const position = clampPosition({ x: x.value, y: y.value });
    const ownership = getOwnershipFromY(position.y);

    const updated = await db.boardItem.update({
      where: { id: boardItemId.value },
      data: {
        x: position.x,
        y: position.y,
        ...(existing.itemType === "gear" ? { ownership } : {}),
      },
      include: { gearItem: true },
    });

    return Response.json({ item: toBoardItemDTO(updated) });
  } catch (error) {
    console.error("[api/board/move]", error);
    return errorResponse(500, "Something went wrong moving that card.");
  }
}
