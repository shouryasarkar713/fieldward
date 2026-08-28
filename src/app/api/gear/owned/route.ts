import { db } from "@/lib/db";
import { toBoardItemDTO } from "@/lib/gear";
import { isBoardLocked, loadBoardItems, resolveNewPosition } from "@/lib/board-server";
import { errorResponse, optionalString, readJsonBody, requireString } from "@/lib/validate";

/**
 * Normalizes strings for loose/fuzzy matching against catalog names.
 */
function normalizeName(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * POST /api/gear/owned
 * Body: { sessionId, name, category?, note? }
 *
 * Implements the mark_item_owned tool logic:
 * 1. Checks if the board is locked.
 * 2. Looks for an existing catalog GearItem with a close/fuzzy case-insensitive name match.
 * 3. If none found, creates a new GearItem with source: "owned" (price: 0).
 * 4. Places the item on the board with ownership: "owned" in the "Already Have" zone.
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

    const nameResult = await requireString(body, "name", { max: 120 });
    if (!nameResult.ok) return errorResponse(400, nameResult.error);
    const rawName = nameResult.value.trim();

    const categoryResult = await optionalString(body, "category", { max: 60 });
    if (!categoryResult.ok) return errorResponse(400, categoryResult.error);
    const category = categoryResult.value?.trim() || "Other";

    const noteResult = await optionalString(body, "note", { max: 280 });
    if (!noteResult.ok) return errorResponse(400, noteResult.error);
    const note = noteResult.value?.trim();

    // 1. Fuzzy search existing catalog items (exclude user personal owned gear)
    const catalogGear = await db.gearItem.findMany({
      where: { source: "catalog" },
    });
    const queryNorm = normalizeName(rawName);

    let matchedGear = catalogGear.find((item) => normalizeName(item.name) === queryNorm);
    if (!matchedGear) {
      // Loose word match (e.g. "Hollowpine tent" matches "Hollowpine 2P Tent")
      matchedGear = catalogGear.find((item) => {
        const itemNorm = normalizeName(item.name);
        return itemNorm.includes(queryNorm) || queryNorm.includes(itemNorm);
      });
    }

    let gearItem = matchedGear;
    let matchedExisting = matchedGear !== undefined;

    // 2. If no catalog match, create a new owned GearItem
    if (!gearItem) {
      matchedExisting = false;
      gearItem = await db.gearItem.create({
        data: {
          name: rawName,
          category,
          description: "Personal gear marked as already owned.",
          price: 0,
          tags: JSON.stringify([category.toLowerCase(), "owned"]),
          imageUrl: "/logo.svg",
          availability: "Owned",
          source: "owned",
        },
      });
    }

    // 3. Place item onto the board in the "Already have" (top) zone
    const existing = await loadBoardItems(sessionId);
    const position = resolveNewPosition(
      undefined,
      undefined,
      existing.map((i) => ({ x: i.x, y: i.y })),
      "owned",
    );

    const created = await db.boardItem.create({
      data: {
        sessionId,
        itemType: "gear",
        gearItemId: gearItem.id,
        quantity: 1,
        addedBy: "agent",
        ownership: "owned",
        note: note || (matchedExisting ? `Already owned (${gearItem.name})` : "Already owned"),
        x: position.x,
        y: position.y,
      },
      include: { gearItem: true },
    });

    return Response.json(
      {
        item: toBoardItemDTO(created),
        matchedExisting,
        gearItem: { id: gearItem.id, name: gearItem.name, category: gearItem.category },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/gear/owned]", error);
    return errorResponse(500, "Something went wrong marking that item as owned.");
  }
}
