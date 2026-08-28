import { db } from "@/lib/db";
import { toGearDTO } from "@/lib/gear";
import { errorResponse } from "@/lib/validate";

/**
 * GET /api/gear/[id]
 * Full details for one gear item.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const item = await db.gearItem.findUnique({ where: { id } });
    if (item === null) {
      return errorResponse(404, "Gear item not found.");
    }
    return Response.json({ gear: toGearDTO(item) });
  } catch (error) {
    console.error("[api/gear/[id]]", error);
    return errorResponse(500, "Something went wrong loading that gear item.");
  }
}
