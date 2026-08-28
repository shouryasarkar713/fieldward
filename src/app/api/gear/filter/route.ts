import { db } from "@/lib/db";
import { toGearDTO } from "@/lib/gear";
import { isCategory } from "@/lib/types";
import { errorResponse, optionalNumber, optionalStringArray, readJsonBody } from "@/lib/validate";

/**
 * POST /api/gear/filter
 * Body: { category?, minPrice?, maxPrice?, tags? }
 *
 * Prices are in DOLLARS (converted to cents here). When several tags are
 * supplied, items matching ANY of them are returned.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const category = body.category;
    if (category !== undefined && category !== null && !isCategory(category)) {
      return errorResponse(400, 'Field "category" must be one of: Backpacks, Footwear, Shelter, Cook Gear.');
    }

    const minPrice = await optionalNumber(body, "minPrice", { min: 0, max: 100_000 });
    if (!minPrice.ok) return errorResponse(400, minPrice.error);
    const maxPrice = await optionalNumber(body, "maxPrice", { min: 0, max: 100_000 });
    if (!maxPrice.ok) return errorResponse(400, maxPrice.error);
    const tags = await optionalStringArray(body, "tags");
    if (!tags.ok) return errorResponse(400, tags.error);

    if (
      minPrice.value !== undefined &&
      maxPrice.value !== undefined &&
      minPrice.value > maxPrice.value
    ) {
      return errorResponse(400, '"minPrice" must not exceed "maxPrice".');
    }

    const gear = await db.gearItem.findMany({
      where: {
        source: "catalog",
        ...(category ? { category } : {}),
        ...(minPrice.value !== undefined ? { price: { gte: Math.round(minPrice.value * 100) } } : {}),
        ...(maxPrice.value !== undefined ? { price: { lte: Math.round(maxPrice.value * 100) } } : {}),
        // JSON-encoded array in a TEXT column: substring match is enough for
        // tag filtering at this library size.
        ...(tags.value && tags.value.length > 0
          ? { OR: tags.value.map((tag) => ({ tags: { contains: tag } })) }
          : {}),
      },
      orderBy: [{ category: "asc" }, { price: "asc" }],
    });

    return Response.json({
      count: gear.length,
      appliedFilters: {
        category: category ?? null,
        minPrice: minPrice.value ?? null,
        maxPrice: maxPrice.value ?? null,
        tags: tags.value ?? [],
      },
      results: gear.map(toGearDTO),
    });
  } catch (error) {
    console.error("[api/gear/filter]", error);
    return errorResponse(500, "Something went wrong filtering the gear library.");
  }
}
