import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { isBoardLocked, loadBoardItems, resolveNewPosition } from "@/lib/board-server";
import { isAddedBy, isItemType } from "@/lib/types";
import {
  errorResponse,
  optionalInt,
  optionalNumber,
  optionalString,
  readJsonBody,
  requireString,
} from "@/lib/validate";

/**
 * POST /api/board/place
 * Body: { sessionId, itemType: "gear" | "day", gearItemId?, label?, text?,
 *         x?, y?, quantity?, addedBy, note? }
 *
 * The single write path for new board cards, used by BOTH parties:
 * - the human UI (drag from the tray, + button, day-block button) sends
 *   addedBy "human";
 * - the place_on_board WebMCP tool sends addedBy "agent" (hardcoded in the
 *   tool layer — never trusted from the wire).
 *
 * x/y are optional for everyone: omitted, the server scans for the next
 * open slot so agents never do layout math.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionIdResult = await requireString(body, "sessionId", { max: 100 });
    if (!sessionIdResult.ok) return errorResponse(400, sessionIdResult.error);
    const sessionId = sessionIdResult.value;

    if (await isBoardLocked(sessionId)) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const itemType = body.itemType;
    if (!isItemType(itemType)) {
      return errorResponse(400, 'Field "itemType" must be "gear" or "day".');
    }

    const addedBy = body.addedBy;
    if (!isAddedBy(addedBy)) {
      return errorResponse(400, 'Field "addedBy" must be "human" or "agent".');
    }

    const note = await optionalString(body, "note", { max: 280 });
    if (!note.ok) return errorResponse(400, note.error);

    // Position: caller-supplied (clamped to the board bounds) or the next
    // open slot. The generous validation range is deliberate — clamping is
    // this route's job, so nobody can fling a card into the void.
    const x = await optionalNumber(body, "x", { min: 0, max: 1_000_000 });
    if (!x.ok) return errorResponse(400, x.error);
    const y = await optionalNumber(body, "y", { min: 0, max: 1_000_000 });
    if (!y.ok) return errorResponse(400, y.error);

    if (itemType === "gear") {
      const gearItemId = await requireString(body, "gearItemId");
      if (!gearItemId.ok) return errorResponse(400, gearItemId.error);

      const quantity = await optionalInt(body, "quantity", { min: 1, max: 20 });
      if (!quantity.ok) return errorResponse(400, quantity.error);

      const gearItem = await db.gearItem.findUnique({ where: { id: gearItemId.value } });
      if (gearItem === null) {
        return errorResponse(404, "Gear item not found.");
      }

      const existing = await loadBoardItems(sessionId);
      const position = resolveNewPosition(x.value, y.value, existing.map((i) => ({ x: i.x, y: i.y })));

      const created = await db.boardItem.create({
        data: {
          sessionId,
          itemType: "gear",
          gearItemId: gearItem.id,
          quantity: quantity.value ?? 1,
          addedBy,
          ...(note.value !== undefined ? { note: note.value } : {}),
          x: position.x,
          y: position.y,
        },
        include: { gearItem: true },
      });

      return Response.json({ item: toBoardItemDTO(created) }, { status: 201 });
    }

    // itemType === "day" — a route/segment card the human authors.
    if (addedBy === "agent") {
      return errorResponse(403, "Day blocks are authored by the human — the agent can move or remove them, not create them.");
    }

    const label = await requireString(body, "label", { max: 120 });
    if (!label.ok) return errorResponse(400, label.error);
    const text = await optionalString(body, "text", { max: 280 });
    if (!text.ok) return errorResponse(400, text.error);

    const existing = await loadBoardItems(sessionId);
    const position = resolveNewPosition(x.value, y.value, existing.map((i) => ({ x: i.x, y: i.y })));

    const created = await db.boardItem.create({
      data: {
        sessionId,
        itemType: "day",
        label: label.value,
        ...(text.value !== undefined ? { text: text.value } : {}),
        addedBy,
        x: position.x,
        y: position.y,
      },
      include: { gearItem: true },
    });

    return Response.json({ item: toBoardItemDTO(created) }, { status: 201 });
  } catch (error) {
    console.error("[api/board/place]", error);
    return errorResponse(500, "Something went wrong placing that on the board.");
  }
}
