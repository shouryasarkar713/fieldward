import { db } from "@/lib/db";
import { toGearDTO } from "@/lib/gear";
import { errorResponse, requireStringArray, readJsonBody } from "@/lib/validate";

/**
 * POST /api/gear/compare
 * Body: { gearItemIds: string[] } — 2 to 4 ids.
 *
 * Returns every field for each item, in the order the caller supplied.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const ids = await requireStringArray(body, "gearItemIds", { minItems: 2, maxItems: 4 });
    if (!ids.ok) {
      return errorResponse(400, 'Field "gearItemIds" must contain between 2 and 4 gear item ids.');
    }

    const gear = await db.gearItem.findMany({ where: { id: { in: ids.value } } });
    if (gear.length !== ids.value.length) {
      const found = new Set(gear.map((item) => item.id));
      const missing = ids.value.filter((id) => !found.has(id));
      return errorResponse(404, `Gear item(s) not found: ${missing.join(", ")}`);
    }

    // Preserve the caller's ordering — comparison columns read top to bottom
    // in the order the agent asked for them.
    const byId = new Map(gear.map((item) => [item.id, item]));
    const ordered = ids.value.map((id) => byId.get(id)!);

    return Response.json({
      count: ordered.length,
      gear: ordered.map(toGearDTO),
    });
  } catch (error) {
    console.error("[api/gear/compare]", error);
    return errorResponse(500, "Something went wrong comparing gear.");
  }
}
