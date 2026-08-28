import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { errorResponse } from "@/lib/validate";

/**
 * DELETE /api/board/[boardItemId]
 *
 * Removes a card from the board — used by the human UI's card ✕ and by the
 * remove_from_board WebMCP tool.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ boardItemId: string }> },
): Promise<Response> {
  try {
    const { boardItemId } = await params;
    const existing = await db.boardItem.findUnique({ where: { id: boardItemId }, include: { gearItem: true } });
    if (existing === null) {
      return errorResponse(404, "Board item not found.");
    }

    const brief = await db.tripBrief.findUnique({ where: { sessionId: existing.sessionId } });
    if (brief?.lockedAt !== null && brief !== null) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    await db.boardItem.delete({ where: { id: boardItemId } });

    return Response.json({ removed: true, item: toBoardItemDTO(existing) });
  } catch (error) {
    console.error("[api/board/[boardItemId]]", error);
    return errorResponse(500, "Something went wrong removing that card.");
  }
}
